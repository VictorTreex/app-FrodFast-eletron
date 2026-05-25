const { app, BrowserWindow, ipcMain, screen } = require('electron');

const path = require('path');

const { exec } = require('child_process');

const fs = require('fs');

const { autoUpdater } = require('electron-updater');

const { printOrder: printOrderService } = require('./printService');

const { SUPABASE_URL, SUPABASE_ANON_KEY } = require('./config');



let mainWindow;

// ========================= PRINTEDIDS PERSISTENTE =========================
// Persiste IDs de pedidos já impressos para evitar reimpressão após reinicio do app

const printedIdsPath = path.join(__dirname, 'printed-ids.json');

function loadPrintedIds() {
  try {
    if (fs.existsSync(printedIdsPath)) {
      const data = JSON.parse(fs.readFileSync(printedIdsPath, 'utf8'));
      const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24h
      // Só carrega IDs das últimas 24h para evitar acúmulo infinito
      const recent = Object.entries(data).filter(([, ts]) => ts > cutoff);
      return new Map(recent);
    }
  } catch (e) {
    console.warn('⚠️ [PRINTEDIDS] Erro ao carregar IDs:', e.message);
  }
  return new Map();
}

function savePrintedId(orderId) {
  try {
    let data = {};
    if (fs.existsSync(printedIdsPath)) {
      data = JSON.parse(fs.readFileSync(printedIdsPath, 'utf8'));
    }
    data[orderId] = Date.now();
    // Limpar entradas > 24h
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const key of Object.keys(data)) {
      if (data[key] < cutoff) delete data[key];
    }
    fs.writeFileSync(printedIdsPath, JSON.stringify(data), 'utf8');
  } catch (e) {
    console.warn('⚠️ [PRINTEDIDS] Erro ao salvar ID:', e.message);
  }
}

// Map: orderId -> timestamp de impressão
let printedIdsMap = loadPrintedIds();

// Compatibilidade com código que usa printedIds.has / printedIds.add
const printedIds = {
  has: (id) => printedIdsMap.has(id),
  add: (id) => {
    printedIdsMap.set(id, Date.now());
    savePrintedId(id);
  }
};



// Sistema de fila de impressão

const printQueue = [];

let isPrinting = false;



// Configurações de impressora

const configPath = path.join(__dirname, 'printer-config.json');

let printerConfig = {

  selectedPrinter: '',

  useSilentMode: true,

  printerType: 'thermal', // 'thermal' or 'normal'

  autoPrint: true,

  splitByCategory: false

};



// ========================= POLLING DE PEDIDOS (SEM WEBSOCKET) =========================



let lastOrderCheck = null;

let pollingInterval = null;



async function checkForNewOrders() {

  try {

    console.log('� [POLLING] Verificando novos pedidos...');

    

    // Buscar pedidos recentes (últimos 5 minutos)

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    

    const response = await fetch(`${SUPABASE_URL}/rest/v1/orders?select=*&created_at=gte.${fiveMinutesAgo}&order=created_at.desc&limit=10`, {

      headers: {

        'apikey': SUPABASE_ANON_KEY,

        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,

        'Content-Type': 'application/json'

      }

    });

    

    if (!response.ok) {

      throw new Error(`HTTP ${response.status}`);

    }

    

    const orders = await response.json();

    

    console.log(`� [POLLING] ${orders.length} pedidos encontrados nos últimos 5 minutos`);

    

    // Verificar cada pedido

    for (const order of orders) {

      // Verificar se já imprimiu este pedido

      if (printedIds.has(order.id)) {

        continue;

      }

      

      console.log('📦 [POLLING] Novo pedido detectado:', order.id, order.customer_name);

      

      // Verificar se auto-print está ativado

      if (!printerConfig.autoPrint) {

        console.log('⏭️ [POLLING] Auto-print desativado, ignorando pedido');

        continue;

      }

      

      // Marcar como impresso para evitar duplicação

      printedIds.add(order.id);

      

      // Buscar dados do pedido e gerar HTML com retry automático
      console.log('🖨️ [POLLING] Buscando dados para impressão com retry...');

      let html = null;

      for (let i = 0; i < 5; i++) {
        html = await printOrderService(order.id, printerConfig.splitByCategory);

        // Verifica se já veio conteúdo do cliente
        if (html && html.includes(order.customer_name)) {
          console.log('✅ Pedido completo carregado');
          break;
        }

        console.log(`⏳ Tentativa ${i + 1}/5 - aguardando itens...`);

        await new Promise(resolve => setTimeout(resolve, 1500));
      }

      

      if (!html) {

        console.error('❌ [POLLING] Erro ao gerar HTML do pedido após 5 tentativas');

        continue;

      }

      

      console.log('✅ [POLLING] HTML gerado, enviando para fila de impressão...');

      

      // Adicionar à fila de impressão

      const jobId = 'polling_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

      const job = {

        id: jobId,

        data: { 

          html, 

          orderId: order.id, 

          timestamp: new Date().toISOString(),

          title: `Pedido #${order.id.slice(0, 8).toUpperCase()}`

        },

        timestamp: new Date().toISOString()

      };

      

      printQueue.push(job);

      console.log('📋 [POLLING] Job adicionado à fila:', jobId, 'Total:', printQueue.length);

      

      // Processar fila se não estiver ocupado

      if (!isPrinting) {

        await processPrintQueue();

      }

    }

    

    lastOrderCheck = new Date();

  } catch (error) {

    console.error('❌ [POLLING] Erro ao verificar pedidos:', error);

  }

}



function startOrderPolling() {

  console.log('🔄 [POLLING] Iniciando polling de pedidos (intervalo: 10s)...');

  

  // Verificar imediatamente

  checkForNewOrders();

  

  // Configurar polling a cada 10 segundos

  pollingInterval = setInterval(checkForNewOrders, 10000);

}



function stopOrderPolling() {

  if (pollingInterval) {

    clearInterval(pollingInterval);

    pollingInterval = null;

    console.log('🛑 [POLLING] Polling de pedidos parado');

  }

}



// ========================= CONFIG =========================



function loadPrinterConfig() {

  try {

    if (fs.existsSync(configPath)) {

      const data = fs.readFileSync(configPath, 'utf8');

      printerConfig = { ...printerConfig, ...JSON.parse(data) };

      console.log('✅ [CONFIG] Configurações carregadas:', printerConfig);

    }

  } catch (error) {

    console.warn('⚠️ [CONFIG] Erro ao carregar configurações:', error.message);

  }

}



function savePrinterConfig() {

  try {

    fs.writeFileSync(configPath, JSON.stringify(printerConfig, null, 2));

    console.log('✅ [CONFIG] Configurações salvas');

  } catch (error) {

    console.error('❌ [CONFIG] Erro ao salvar configurações:', error.message);

  }

}



// ========================= PRINTERS =========================



const getPrinters = async () => {

  console.log('🖨️ [MAIN] Listando impressoras disponíveis...');



  try {

    if (mainWindow && mainWindow.webContents.getPrintersAsync) {

      const printers = await mainWindow.webContents.getPrintersAsync();

      const printerNames = printers.map(p => p.name).filter(Boolean);

      console.log('✅ [MAIN] Impressoras encontradas (API Async):', printerNames);

      return printerNames;

    }



    return new Promise((resolve, reject) => {

      exec('wmic printer get name', (error, stdout) => {

        if (error) {

          exec('powershell "Get-Printer | Select-Object Name"', (error2, stdout2) => {

            if (error2) {

              reject(error2);

            } else {

              const printers = stdout2.split('\n')

                .filter(line => line.trim() && !line.includes('Name') && !line.includes('---'))

                .map(line => line.trim());

              resolve(printers);

            }

          });

        } else {

          const printers = stdout.split('\n')

            .filter(line => line.trim() && line !== 'Name' && !line.includes('No Instance'))

            .map(line => line.trim());

          resolve(printers);

        }

      });

    });

  } catch (error) {

    console.error('❌ [MAIN] Erro geral ao listar impressoras:', error);

    return [];

  }

};



// ========================= PRINT JOB =========================

const printHistory = new Map();

function isDuplicatePrint(html) {
  let hash = 0;
  for (let i = 0; i < html.length; i++) {
    hash = (Math.imul(31, hash) + html.charCodeAt(i)) | 0;
  }
  const key = hash.toString(36);
  const now = Date.now();
  if (printHistory.has(key) && now - printHistory.get(key) < 3000) {
    console.log('[PRINT] Job duplicado detectado, ignorando');
    return true;
  }
  printHistory.set(key, now);
  for (const [k, ts] of printHistory) {
    if (now - ts > 60000) printHistory.delete(k);
  }
  return false;
}

async function executePrintJob(job) {
  let printWindow = null;
  let tempHtmlPath = null;
  let tempPdfPath = null;

  try {
    console.log('[PRINT] Iniciando job:', job.id);

    if (!job.data.forcePrint && isDuplicatePrint(job.data.html)) {
      return true;
    }

    const printers = await getPrinters();
    let selectedPrinter = printerConfig.selectedPrinter;
    if (!selectedPrinter || !printers.includes(selectedPrinter)) {
      selectedPrinter = printers[0] || '';
    }
    console.log('[PRINT] Impressora:', selectedPrinter);
    if (!selectedPrinter) throw new Error('Nenhuma impressora disponivel');

    const html = job.data.html;
    const isThermal = printerConfig.printerType === 'thermal';
    const winWidth = isThermal ? 302 : 794;

    // Janela visivel fora da tela: Chromium renderiza completamente sem aparecer para o usuario.
    // height alto evita que o viewport corte o conteudo antes da medicao do scrollHeight.
    // deviceScaleFactor:1 fixa 96 DPI independente da escala do Windows (125%, 150%...).
    printWindow = new BrowserWindow({
      show: true,
      frame: false,
      skipTaskbar: true,
      alwaysOnTop: false,
      focusable: false,
      width: winWidth,
      height: 4000,
      x: -(winWidth + 20),
      y: 0,
      webPreferences: { sandbox: false, deviceScaleFactor: 1 },
    });

    tempHtmlPath = path.join(app.getPath('temp'), `frodfast_${Date.now()}.html`);
    fs.writeFileSync(tempHtmlPath, html, 'utf-8');
    await printWindow.loadFile(tempHtmlPath);
    await new Promise((r) => setTimeout(r, 1500));

    const scrollH = await printWindow.webContents
      .executeJavaScript('Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)')
      .catch(() => 0);
    console.log('[PRINT] scrollHeight:', scrollH, 'px');

    if (scrollH < 50) throw new Error(`Conteudo nao renderizou (scrollHeight=${scrollH}px)`);

    if (isThermal) {
      // -------------------------------------------------------
      // TERMICA: webContents.print() com pageSize calculado.
      // Envia direto ao driver Windows — sem SumatraPDF no meio.
      // SumatraPDF escalava o conteudo para o tamanho de papel
      // configurado no driver (ex: 80x70mm), cortando o ticket.
      // Com webContents.print() o Chromium usa as dimensoes
      // exatas que calculamos, igual ao que o browser faz.
      // -------------------------------------------------------
      const heightMicrons = Math.ceil(scrollH * (25400 / 96)) + 25000; // +25mm folga
      console.log('[PRINT] Imprimindo termica:', (80000/1000).toFixed(0), 'mm x', (heightMicrons/1000).toFixed(0), 'mm');

      return await new Promise((resolve, reject) => {
        printWindow.webContents.print({
          silent: true,
          printBackground: true,
          deviceName: selectedPrinter,
          pageSize: { width: 80000, height: heightMicrons },
          margins: { marginType: 'none' },
          scaleFactor: 100,
          copies: 1,
        }, (success, errorType) => {
          console.log('[PRINT] Callback termica:', { success, errorType });
          if (success) {
            if (mainWindow) mainWindow.webContents.send('print-success', { jobId: job.id, printer: selectedPrinter });
            resolve(true);
          } else {
            reject(new Error(errorType || 'Falha na impressao termica'));
          }
        });
      });

    } else {
      // -------------------------------------------------------
      // NORMAL (A4): webContents.print() funciona bem
      // -------------------------------------------------------
      return await new Promise((resolve, reject) => {
        printWindow.webContents.print({
          silent: printerConfig.useSilentMode,
          printBackground: true,
          deviceName: selectedPrinter,
          copies: 1,
          landscape: false,
          pageSize: 'A4',
          margins: { marginType: 'none' },
          scaleFactor: 100,
        }, (success, errorType) => {
          console.log('[PRINT] Callback A4:', { success, errorType });
          if (success) {
            if (mainWindow) mainWindow.webContents.send('print-success', { jobId: job.id, printer: selectedPrinter });
            resolve(true);
          } else {
            reject(new Error(errorType || 'Falha na impressao'));
          }
        });
      });
    }

  } catch (error) {
    console.error('[PRINT] Erro:', error.message);
    if (mainWindow) mainWindow.webContents.send('print-error', { jobId: job.id, error: error.message });
    throw error;
  } finally {
    if (tempHtmlPath) try { fs.unlinkSync(tempHtmlPath); } catch {}
    if (tempPdfPath) setTimeout(() => { try { fs.unlinkSync(tempPdfPath); } catch {} }, 8000);
    if (printWindow) setTimeout(() => { if (!printWindow.isDestroyed()) printWindow.destroy(); }, 3000);
  }
}

async function processPrintQueue() {
  if (isPrinting || printQueue.length === 0) return;

  isPrinting = true;
  console.log('[QUEUE] Processando', printQueue.length, 'job(s)');

  try {
    while (printQueue.length > 0) {
      const job = printQueue.shift();
      try {
        await executePrintJob(job);
      } catch (err) {
        console.error('[QUEUE] Erro no job:', job.id, err.message);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  } finally {
    isPrinting = false;
    console.log('[QUEUE] Fila processada');
  }
}



// ========================= WINDOW =========================



function createWindow() {

  const preloadPath = path.join(__dirname, 'preload.js');



  loadPrinterConfig();



  mainWindow = new BrowserWindow({

    width: 1200,

    height: 800,

    show: false,

    autoHideMenuBar: true,

    icon: path.join(__dirname, 'assets/icon.png'),

    webPreferences: {

      nodeIntegration: false,

      contextIsolation: true,

      preload: preloadPath,

      webSecurity: true,

      allowRunningInsecureContent: false,

      sandbox: false

    }

  });



  mainWindow.loadURL('http://localhost:8080/');



  // Iniciar polling de pedidos (sem WebSocket)

  startOrderPolling();



  mainWindow.once('ready-to-show', () => {

    mainWindow.show();

  });

  // F12 abre DevTools para visualizar logs de impressao
  const { globalShortcut } = require('electron');
  globalShortcut.register('F12', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.toggleDevTools();
    }
  });

}



// ========================= IPC EVENTS =========================



ipcMain.handle('get-printers', async () => {

  try {

    const printers = await getPrinters();

    return { success: true, printers };

  } catch (error) {

    console.error('❌ [MAIN] Erro ao obter impressoras:', error);

    return { success: false, error: error.message };

  }

});



ipcMain.handle('print-order', async (event, { html, orderId, timestamp }) => {

  console.log('🖨️ [PRINT] print-order recebido:', {

    orderId,

    contentLength: html?.length,

    timestamp

  });

  // Marcar como impresso para que o polling não reimprima este pedido
  if (orderId) {
    printedIds.add(orderId);
    console.log('📌 [PRINT] orderId marcado como impresso (via IPC):', orderId);
  }

  // Criar job e adicionar à fila

  const jobId = 'print_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

  const job = {

    id: jobId,

    data: { html, orderId, timestamp },

    timestamp: new Date().toISOString()

  };

  

  printQueue.push(job);

  console.log('� [QUEUE] Job adicionado à fila:', jobId, 'Total:', printQueue.length);

  

  // Processar fila se não estiver ocupado

  if (!isPrinting) {

    processPrintQueue();

  }

  

  // Retornar ID do job para acompanhamento

  return { 

    success: true, 

    jobId: jobId,

    queuePosition: printQueue.length,

    timestamp: new Date().toISOString()

  };

});



ipcMain.handle('set-printer', async (event, printerName) => {

  console.log('⚙️ [PRINTER] Configurando impressora:', printerName);

  

  const printers = await getPrinters();

  if (printerName && printers.includes(printerName)) {

    printerConfig.selectedPrinter = printerName;

    savePrinterConfig();

    console.log('✅ [PRINTER] Impressora configurada com sucesso');

    return { success: true, printer: printerName };

  } else {

    console.error('❌ [PRINTER] Impressora não encontrada:', printerName);

    return { success: false, error: 'Impressora não encontrada', availablePrinters: printers };

  }

});



ipcMain.handle('set-silent-mode', async (event, useSilent) => {

  console.log('⚙️ [CONFIG] Configurando modo silencioso:', useSilent);

  

  printerConfig.useSilentMode = Boolean(useSilent);

  savePrinterConfig();

  console.log('✅ [CONFIG] Modo silencioso configurado');

  return { success: true, useSilent: printerConfig.useSilentMode };

});



ipcMain.handle('set-printer-type', async (event, printerType) => {

  console.log('⚙️ [CONFIG] Configurando tipo de impressora:', printerType);

  

  if (printerType === 'thermal' || printerType === 'normal') {

    printerConfig.printerType = printerType;

    savePrinterConfig();

    console.log('✅ [CONFIG] Tipo de impressora configurado com sucesso');

    return { success: true, printerType: printerConfig.printerType };

  } else {

    console.error('❌ [CONFIG] Tipo de impressora inválido:', printerType);

    return { success: false, error: 'Tipo de impressora inválido. Use "thermal" ou "normal".' };

  }

});



ipcMain.handle('get-printer-config', async () => {

  const printers = await getPrinters();

  return {

    config: printerConfig,

    availablePrinters: printers,

    queueStatus: {

      length: printQueue.length,

      isPrinting: isPrinting

    }

  };

});



ipcMain.handle('health-check', async () => {

  console.log('🏥 [MAIN] Health check solicitado');

  const printers = await getPrinters();

  return {

    loaded: true,

    timestamp: new Date().toISOString(),

    version: '1.2.4',

    printerReady: printers.length > 0,

    queueStatus: {

      length: printQueue.length,

      isPrinting: isPrinting

    }

  };

});



ipcMain.on('debug-message', (event, message) => {

  console.log('📞 [MAIN] Mensagem do renderer:', message);

});



// ========================= AUTO UPDATE =========================



function setupAutoUpdater() {

  console.log('🔄 [UPDATE] Configurando auto-updater...');

  

  // Configurações nativas do electron-updater

  // Não usar setFeedURL - electron-builder já configura automaticamente

  autoUpdater.autoDownload = true;

  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.allowDowngrade = false;

  

  // Habilitar logger para debug (produção)

  autoUpdater.logger = require('electron-log');

  autoUpdater.logger.transports.file.level = 'info';

  

  // IPC para verificação manual de atualizações

  ipcMain.on('check-for-updates', () => {

    console.log('🔍 [UPDATE] Verificação manual solicitada pelo renderer...');

    autoUpdater.checkForUpdates();

  });

  

  // IPC para instalação manual quando usuário confirmar

  ipcMain.handle('install-update-now', async () => {

    console.log('🚀 [UPDATE] Instalando atualização solicitada pelo usuário...');

    autoUpdater.quitAndInstall();

  });

  

  // Eventos do auto-updater

  autoUpdater.on('checking-for-update', () => {

    console.log('🔍 [UPDATE] Verificando atualizações...');

    if (mainWindow) {

      mainWindow.webContents.send('update-status', { status: 'checking' });

    }

  });

  

  autoUpdater.on('update-available', (info) => {

    console.log('⬇️ [UPDATE] Atualização disponível:', info.version);

    if (mainWindow) {

      mainWindow.webContents.send('update-status', { 

        status: 'available', 

        version: info.version,

        releaseNotes: info.releaseNotes 

      });

    }

  });

  

  autoUpdater.on('update-not-available', (info) => {

    console.log('✅ [UPDATE] App está atualizado. Versão:', info.version);

    if (mainWindow) {

      mainWindow.webContents.send('update-status', { 

        status: 'not-available', 

        version: info.version 

      });

    }

  });

  

  autoUpdater.on('error', (err) => {

    console.error('❌ [UPDATE] Erro no update:', err);

    if (mainWindow) {

      mainWindow.webContents.send('update-status', { 

        status: 'error', 

        error: err.message 

      });

    }

  });

  

  autoUpdater.on('download-progress', (progressObj) => {

    let log_message = "📦 [UPDATE] Baixando atualização: ";

    log_message += Math.round(progressObj.percent) + "%";

    log_message += " (" + progressObj.transferred + "/" + progressObj.total + ")";

    console.log(log_message);

    

    if (mainWindow) {

      mainWindow.webContents.send('update-progress', {

        percent: Math.round(progressObj.percent),

        transferred: progressObj.transferred,

        total: progressObj.total

      });

    }

  });

  

  autoUpdater.on('update-downloaded', (info) => {

    console.log('🚀 [UPDATE] Atualização baixada! Aguardando confirmação do usuário...');

    if (mainWindow) {

      mainWindow.webContents.send('update-status', { 

        status: 'downloaded',

        version: info.version,

        message: 'Atualização pronta para instalar'

      });

    }

    

    // Não reiniciar automaticamente - aguardar confirmação do usuário

    // O usuário pode clicar em botão ou fechar o app para instalar automaticamente

  });

}



// Quando o app estiver pronto

app.whenReady().then(() => {

  console.log('🚀 [MAIN] App pronto, criando janela...');

  

  // Configurar auto-updater

  setupAutoUpdater();

  

  createWindow();

  

  // Primeira verificação de atualizações após 5 segundos

  setTimeout(() => {

    console.log('🔄 [UPDATE] Iniciando primeira verificação de atualizações...');

    autoUpdater.checkForUpdates();

  }, 5000);

  

  // Verificação recorrente automática a cada 1 hora
  // (60s causava rate limit na API pública do GitHub: 60 req/h)

  setInterval(() => {

    console.log('🔄 [UPDATE] Verificação recorrente de atualizações...');

    autoUpdater.checkForUpdates();

  }, 60 * 60 * 1000); // 1 hora

});



// Fechar todas as janelas quando todas forem fechadas

app.on('window-all-closed', () => {

  console.log('🔒 [MAIN] Todas as janelas fechadas, saindo...');

  if (process.platform !== 'darwin') {

    app.quit();

  }

});



app.on('activate', () => {

  console.log('🔄 [MAIN] App ativado');

  if (BrowserWindow.getAllWindows().length === 0) {

    createWindow();

  }

});



// Log de erros não capturados

process.on('uncaughtException', (err) => {

  console.error('💥 [MAIN] Erro não capturado:', err);

});



process.on('unhandledRejection', (reason, promise) => {

  console.error('💥 [MAIN] Rejeição não tratada:', reason);

});