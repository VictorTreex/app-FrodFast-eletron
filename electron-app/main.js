const { app, BrowserWindow, ipcMain } = require('electron');

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



// Sistema anti-duplicação

const printHistory = new Map();

const PRINT_DEBOUNCE_MS = 2000;



function generateContentHash(html) {

  // Hash simples para detectar duplicatas

  let hash = 0;

  for (let i = 0; i < html.length; i++) {

    const char = html.charCodeAt(i);

    hash = ((hash << 5) - hash) + char;

    hash = hash & hash;

  }

  return hash.toString(36);

}



function isDuplicatePrint(html) {

  const hash = generateContentHash(html);

  const now = Date.now();

  

  if (printHistory.has(hash)) {

    const lastPrint = printHistory.get(hash);

    if (now - lastPrint < PRINT_DEBOUNCE_MS) {

      console.log('⚠️ [PRINT] Impressão duplicada detectada, ignorando');

      return true;

    }

  }

  

  printHistory.set(hash, now);

  // Limpar histórico antigo (manter apenas últimos 10 minutos)

  for (const [key, timestamp] of printHistory.entries()) {

    if (now - timestamp > 600000) {

      printHistory.delete(key);

    }

  }

  return false;

}



// Helper para aguardar renderização completa
// loadFile() já aguarda did-finish-load, então só precisamos
// de um delay para o CSS layout ser calculado.
// requestAnimationFrame NÃO dispara em janelas ocultas (show:false),
// por isso usamos setTimeout simples.

async function waitForPrintReady(printWindow) {
  // Medir altura real do conteúdo para diagnóstico
  try {
    const height = await printWindow.webContents.executeJavaScript(
      'document.body ? document.body.scrollHeight : 0'
    );
    console.log('📐 [PRINT] Altura do conteúdo (screen):', height, 'px');
    if (height < 10) {
      console.warn('⚠️ [PRINT] Conteúdo com altura suspeita! HTML pode não ter carregado.');
    }
  } catch (e) {
    console.warn('⚠️ [PRINT] Não foi possível medir altura:', e.message);
  }

  // 600ms é suficiente para CSS layout após did-finish-load
  await new Promise(resolve => setTimeout(resolve, 600));
  console.log('✅ [PRINT] Página pronta para impressão');
}




async function executePrintJob(job) {

  let selectedPrinter = '';

  let printWindow = null;

  let tempFilePath = null;



  try {

    console.log('🖨️ [PRINT] Iniciando job:', job.id);
    console.log('📋 [PRINT] Dados completos do job:', JSON.stringify(job, null, 2));
    console.log('📄 [PRINT] HTML length:', job.data.html?.length);
    console.log('🆔 [PRINT] Order ID:', job.data.orderId);
    console.log('⏰ [PRINT] Timestamp:', job.data.timestamp);
    console.log('📝 [PRINT] Primeiros 500 chars do HTML:', job.data.html?.substring(0, 500));

    

    // Verificar duplicação (apenas se não for reimpressão explícita)
    if (!job.data.forcePrint && isDuplicatePrint(job.data.html)) {

      console.log('⏭️ [PRINT] Job duplicado ignorado');

      return true;

    }

    

    const printers = await getPrinters();

    selectedPrinter = printerConfig.selectedPrinter;



    if (!selectedPrinter || !printers.includes(selectedPrinter)) {

      selectedPrinter = printers.length > 0 ? printers[0] : '';

    }



    if (!selectedPrinter) throw new Error('Nenhuma impressora disponível');



    const htmlContent = job.data.html || '<p>Conteúdo não disponível</p>';



    // Largura da janela compatível com o tipo de impressora (px ≈ mm * 96/25.4)
    const winWidth = printerConfig.printerType === 'thermal' ? 302 : 794;

    printWindow = new BrowserWindow({

      show: false,
      width: winWidth,
      height: 1200,
      webPreferences: {

        sandbox: false

      }

    });



    // Criar arquivo temporário para impressão
    tempFilePath = path.join(app.getPath('temp'), `print-${Date.now()}.html`);
    fs.writeFileSync(tempFilePath, htmlContent, 'utf-8');

    await printWindow.loadFile(tempFilePath);

    // Aguardar renderização completa do DOM
    await waitForPrintReady(printWindow);



    // Para impressora térmica: NÃO enviar pageSize.
    // O driver Windows já sabe o tamanho do rolo (configurado em Propriedades da Impressora).
    // Enviar pageSize customizado em microns faz o driver usar o tamanho mínimo → tira.
    // Para impressora normal (A4): usar string 'A4' que todos os drivers entendem.
    const printOptions = {
      silent: printerConfig.useSilentMode,
      printBackground: true,
      deviceName: selectedPrinter,
      copies: 1,
      landscape: false,
      margins: { marginType: 'none' },
      scaleFactor: 100,
      ...(printerConfig.printerType === 'normal' ? { pageSize: 'A4' } : {})
    };

    console.log('🖨️ [PRINT] Enviando para impressora:', selectedPrinter, '| tipo:', printerConfig.printerType);



    return new Promise((resolve, reject) => {

      console.log('🚀 [PRINT] Chamando webContents.print');

      

      printWindow.webContents.print(printOptions, (success, errorType) => {

        console.log('📨 [PRINT CALLBACK]', { success, errorType });

        // Limpar arquivo temporário após callback do print (spooler já leu o arquivo)
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          try {
            fs.unlinkSync(tempFilePath);
            console.log('🗑️ [PRINT] Arquivo temporário removido');
          } catch (err) {
            console.warn('⚠️ [PRINT] Erro ao remover arquivo temporário:', err.message);
          }
        }

        if (success) {

          console.log('✅ [PRINT] Impressão concluída com sucesso');

          if (mainWindow) {

            mainWindow.webContents.send('print-success', {

              jobId: job.id,

              printer: selectedPrinter,

              timestamp: new Date().toISOString()

            });

          }

          resolve(true);

        } else {

          console.error('❌ [PRINT] Erro na impressão:', errorType);

          reject(new Error(errorType || 'Erro desconhecido'));

        }

      });

    });



  } catch (error) {

    console.error('❌ [PRINT] Erro no job:', error.message);

    if (mainWindow) {

      mainWindow.webContents.send('print-error', {

        jobId: job.id,

        error: error.message,

        printer: selectedPrinter,

        timestamp: new Date().toISOString()

      });

    }

    throw error;

  } finally {

    // Destruir janela após tempo suficiente para o spooler ler o arquivo
    setTimeout(() => {

      if (printWindow && !printWindow.isDestroyed()) {

        console.log('🗑️ [PRINT] Destruindo janela');

        printWindow.destroy();

      }

    }, 8000);

  }

}



async function processPrintQueue() {

  console.log('📋 [QUEUE] processPrintQueue chamado:', { 

    isPrinting, 

    queueLength: printQueue.length 

  });

  

  if (isPrinting) {

    console.log('📋 [QUEUE] Já está imprimindo, job aguardará na fila');

    return;

  }

  

  if (printQueue.length === 0) {

    console.log('📋 [QUEUE] Fila vazia, nada para processar');

    return;

  }



  console.log('📋 [QUEUE] Processando fila, jobs:', printQueue.length);

  isPrinting = true;



  try {

    while (printQueue.length > 0) {

      const job = printQueue.shift();

      console.log('📋 [QUEUE] Processando job:', job.id);



      try {

        await executePrintJob(job);

      } catch (error) {

        console.error('❌ [QUEUE] Erro no job:', job.id, error.message);

      }



      // Pequeno delay entre impressões para evitar sobrecarga

      await new Promise(resolve => setTimeout(resolve, 500));

    }

  } finally {

    isPrinting = false;

    console.log('✅ [QUEUE] Fila processada, isPrinting resetado para false');

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



  mainWindow.loadURL('http://localhost:8081/');



  // Iniciar polling de pedidos (sem WebSocket)

  startOrderPolling();



  mainWindow.once('ready-to-show', () => {

    mainWindow.show();

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

  

  // Verificação recorrente automática a cada 60 segundos

  setInterval(() => {

    console.log('🔄 [UPDATE] Verificação recorrente de atualizações...');

    autoUpdater.checkForUpdates();

  }, 60000); // 60 segundos

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