const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const { printOrder: printOrderService } = require('./printService');

// Configurações do Supabase
const SUPABASE_URL = 'https://kfujkvihymclesabqmsz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmdWprdmloeW1jbGVzYWJxbXN6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MjAxNTU1NTU1NTV9.fake-key-for-development';

let mainWindow;
let printedIds = new Set();

// Sistema de fila de impressão
const printQueue = [];
let isPrinting = false;

// Configurações de impressora
const configPath = path.join(__dirname, 'printer-config.json');
let printerConfig = {
  selectedPrinter: '',
  contentSelectors: ['.print-area', '.pedido', '.order-content', '.receipt', 'main'],
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
      
      // Aguardar um momento para garantir que os itens foram inseridos
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Marcar como impresso para evitar duplicação
      printedIds.add(order.id);
      
      // Buscar dados do pedido e gerar HTML
      console.log('🖨️ [POLLING] Buscando dados para impressão...');
      const html = await printOrderService(order.id, printerConfig.splitByCategory);
      
      if (!html) {
        console.error('❌ [POLLING] Erro ao gerar HTML do pedido');
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
        processPrintQueue();
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

// ========================= TEMPLATE =========================

function createPrintTemplate(content, title = 'Documento', printerType = 'thermal') {
  const isThermal = printerType === 'thermal';
  const width = isThermal ? '280px' : '100%';
  const fontSize = isThermal ? '12px' : '12px';
  const fontFamily = isThermal ? "'Courier New', monospace" : "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif";
  
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
*{box-sizing:border-box;}
body{
font-family:${fontFamily};
font-size:${fontSize};
line-height:1.4;
color:#333;
margin:0;
padding:${isThermal ? '10px' : '20px'};
background:white;
width:${width};
}
table{width:100%;border-collapse:collapse;margin-bottom:15px;}
${isThermal ? 'table th,table td{border:none;padding:4px 0;text-align:left;}' : 'table th,table td{border:1px solid #ddd;padding:8px;text-align:left;}'}
img{max-width:100%;height:auto;}
.header{text-align:center;margin-bottom:${isThermal ? '10px' : '20px'};padding-bottom:${isThermal ? '5px' : '10px'};border-bottom:${isThermal ? '1px dashed #000' : '2px solid #333'};}
.footer{margin-top:${isThermal ? '10px' : '20px'};padding-top:${isThermal ? '5px' : '10px'};border-top:${isThermal ? '1px dashed #000' : '1px solid #ddd'};text-align:center;font-size:10px;color:#666;}
${isThermal ? '.total{font-weight:bold;border-top:1px dashed #000;padding-top:5px;margin-top:10px;}' : ''}
</style>
</head>
<body>
<div class="header">
<h1 style="margin:0;font-size:${isThermal ? '16px' : '24px'};">${title}</h1>
<div style="font-size:${isThermal ? '10px' : '12px'};">${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR')}</div>
</div>
<div class="content">${content}</div>
<div class="footer">Gerado via FrodFast</div>
</body>
</html>`;
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
async function waitForPrintReady(printWindow) {
  console.log('⏳ [PRINT] Aguardando renderização completa...');
  
  return new Promise((resolve) => {
    let ready = false;
    
    const checkReady = () => {
      if (ready) return;
      ready = true;
      console.log('✅ [PRINT] Renderização concluída');
      resolve();
    };
    
    // Aguardar eventos de carregamento
    printWindow.webContents.on('did-finish-load', () => {
      console.log('📄 [PRINT] Página carregada');
    });
    
    printWindow.webContents.on('dom-ready', () => {
      console.log('🎨 [PRINT] DOM pronto');
    });
    
    // Verificar se fontes e imagens estão carregadas
    printWindow.webContents.executeJavaScript(`
      Promise.all([
        document.fonts.ready,
        new Promise((resolve) => {
          const images = document.querySelectorAll('img');
          if (images.length === 0) {
            resolve();
            return;
          }
          let loaded = 0;
          images.forEach(img => {
            if (img.complete) {
              loaded++;
            } else {
              img.onload = () => {
                loaded++;
                if (loaded === images.length) resolve();
              };
              img.onerror = () => {
                loaded++;
                if (loaded === images.length) resolve();
              };
            }
          });
          if (loaded === images.length) resolve();
        })
      ]).then(() => true)
    `).then(() => {
      checkReady();
    }).catch(() => {
      // Fallback se executeJavaScript falhar
      setTimeout(checkReady, 500);
    });
    
    // Timeout de segurança (5 segundos máximo)
    setTimeout(() => {
      if (!ready) {
        console.warn('⚠️ [PRINT] Timeout de renderização, prosseguindo mesmo assim');
        checkReady();
      }
    }, 5000);
  });
}

// Calcular pageSize baseado no tipo de impressora
function calculatePageSize(printerType) {
  if (printerType === 'thermal') {
    // Impressora térmica: 80mm de largura, altura dinâmica
    return {
      width: 80000, // ~80mm
      height: 200000 // altura máxima para pedidos grandes
    };
  } else {
    // Impressora normal: A4
    return {
      width: 210000,
      height: 297000
    };
  }
}

async function executePrintJob(job) {
  let selectedPrinter = '';
  let printWindow = null;

  try {
    console.log('🖨️ [PRINT] Iniciando job:', job.id);
    
    // Verificar duplicação
    if (isDuplicatePrint(job.data.html)) {
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
    const printTemplate = createPrintTemplate(htmlContent, job.data.title || 'Documento', printerConfig.printerType);

    printWindow = new BrowserWindow({
      width: 800,
      height: 600,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        offscreen: true
      }
    });

    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(printTemplate)}`;
    await printWindow.loadURL(dataUrl);
    
    // Aguardar renderização completa em vez de setTimeout fixo
    await waitForPrintReady(printWindow);

    const printOptions = {
      silent: true, // SEMPRE silencioso - não pedir permissão
      printBackground: true,
      scaleFactor: 1,
      deviceName: selectedPrinter,
      copies: 1,
      marginsType: 0,
      pageSize: calculatePageSize(printerConfig.printerType),
      landscape: false
    };

    console.log('🖨️ [PRINT] Enviando para impressora:', selectedPrinter);

    return new Promise((resolve, reject) => {
      printWindow.webContents.print(printOptions, (success, errorType) => {
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
    // Sempre destruir a janela para evitar memory leak
    if (printWindow && !printWindow.isDestroyed()) {
      console.log('🗑️ [PRINT] Destruindo janela de impressão');
      printWindow.destroy();
    }
  }
}

async function processPrintQueue() {
  if (isPrinting || printQueue.length === 0) return;

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
    console.log('✅ [QUEUE] Fila processada');
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

  mainWindow.loadURL('https://www.treexonline.online/');

  // Iniciar polling de pedidos (sem WebSocket)
  startOrderPolling();

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    // DevTools sempre aberto em modo detach para debugging
    mainWindow.webContents.openDevTools({
      mode: 'detach'
    });
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

ipcMain.handle('set-content-selectors', async (event, selectors) => {
  console.log('⚙️ [CONFIG] Configurando seletores:', selectors);
  
  if (Array.isArray(selectors) && selectors.length > 0) {
    printerConfig.contentSelectors = selectors;
    savePrinterConfig();
    console.log('✅ [CONFIG] Seletores configurados com sucesso');
    return { success: true, selectors: selectors };
  } else {
    console.error('❌ [CONFIG] Seletores inválidos');
    return { success: false, error: 'Seletores inválidos' };
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