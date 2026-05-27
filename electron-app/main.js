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

  try {
    console.log('[PRINT] Iniciando job:', job.id);

    if (!job.data.forcePrint && isDuplicatePrint(job.data.html)) {
      return true;
    }

    const html = job.data.html;
    const isThermal = printerConfig.printerType === 'thermal';
    // 302px = 80mm a 96dpi; 794px = A4 a 96dpi
    const winWidth = isThermal ? 302 : 794;

    // Janela de renderização fora da tela.
    // X positivo grande (10000) evita problemas de composição que ocorrem em X negativo
    // em algumas configs de GPU/Windows. deviceScaleFactor:1 fixa 96dpi independente
    // da escala do Windows (125%, 150%...) para que scrollHeight seja sempre em px@96dpi.
    printWindow = new BrowserWindow({
      show: true,
      frame: false,
      skipTaskbar: true,
      alwaysOnTop: false,
      focusable: false,
      width: winWidth,
      height: 4000,
      x: 10000,
      y: 0,
      webPreferences: { sandbox: false, deviceScaleFactor: 1 },
    });

    tempHtmlPath = path.join(app.getPath('temp'), `frodfast_${Date.now()}.html`);
    fs.writeFileSync(tempHtmlPath, html, 'utf-8');
    await printWindow.loadFile(tempHtmlPath);

    // Aguardar fontes e layout finalizarem
    await printWindow.webContents.executeJavaScript(
      'document.fonts.ready.then(() => true)'
    ).catch(() => null);
    await new Promise((r) => setTimeout(r, 800));

    // --- Selecionar impressora ---
    const printers = await getPrinters();
    let selectedPrinter = printerConfig.selectedPrinter;
    if (!selectedPrinter || !printers.includes(selectedPrinter)) {
      selectedPrinter = printers[0] || '';
    }
    console.log('[PRINT] Impressora:', selectedPrinter || '(dialogo do sistema)');
    console.log('[PRINT] Impressoras disponiveis:', printers);

    // --- Modo de impressão ---
    const useSilent = printerConfig.useSilentMode && !!selectedPrinter;
    console.log('[PRINT] Modo:', useSilent ? 'silencioso' : 'dialogo do SO');

    // Para térmica: NÃO especificamos pageSize no JS.
    // O CSS @page { size: 80mm auto; } faz o Chromium criar UMA página de 80mm × altura-do-conteúdo,
    // exatamente como o browser faz ao imprimir — que funciona. Qualquer pageSize JS override
    // esse comportamento com uma altura fixa calculada que pode estar errada → múltiplas tiras.
    // Para A4: especificamos 'A4' normalmente.
    const printOptions = {
      silent: useSilent,
      printBackground: true,
      copies: 1,
      margins: { marginType: 'none' },
      scaleFactor: 100,
    };
    if (!isThermal) printOptions.pageSize = 'A4';
    if (selectedPrinter) printOptions.deviceName = selectedPrinter;

    return await new Promise((resolve, reject) => {
      printWindow.webContents.print(printOptions, (success, errorType) => {
        console.log('[PRINT] Resultado:', { success, errorType, printer: selectedPrinter });
        if (success) {
          if (mainWindow) mainWindow.webContents.send('print-success', { jobId: job.id, printer: selectedPrinter });
          resolve(true);
        } else {
          reject(new Error(errorType || 'Falha na impressao'));
        }
      });
    });

  } catch (error) {
    console.error('[PRINT] Erro:', error.message);
    if (mainWindow) mainWindow.webContents.send('print-error', { jobId: job.id, error: error.message });
    throw error;
  } finally {
    if (tempHtmlPath) try { fs.unlinkSync(tempHtmlPath); } catch {}
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



  const isDev = process.env.NODE_ENV === 'development' || process.env.ELECTRON_DEV === 'true';
  const appURL = isDev ? 'http://localhost:8080/' : 'https://treexonline.online';
  mainWindow.loadURL(appURL);



  // Iniciar polling de pedidos (sem WebSocket)

  startOrderPolling();



  mainWindow.once('ready-to-show', () => {

    mainWindow.show();

  });

  // Verificar updates assim que a página terminar de carregar.
  // O check de 5s dispara antes do site carregar — os eventos IPC são perdidos
  // porque o React ainda não montou os listeners. did-finish-load garante que
  // o renderer já está pronto para receber o evento update-status.
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('🌐 [MAIN] Página carregada, verificando atualizações...');
    setTimeout(() => autoUpdater.checkForUpdates(), 3000);
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

  

  // Verificação recorrente a cada 30 minutos (era 1 hora — muito longo)
  setInterval(() => {
    console.log('🔄 [UPDATE] Verificação recorrente de atualizações...');
    autoUpdater.checkForUpdates();
  }, 30 * 60 * 1000);

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