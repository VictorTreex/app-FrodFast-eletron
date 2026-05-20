const { contextBridge, ipcRenderer } = require('electron');

console.log('🔧 [PRELOAD] Preload script iniciando...');

try {
  contextBridge.exposeInMainWorld('electronAPI', {
    // ========================= PRINTING API =========================

    printOrder: async (html, metadata = {}) => {
      console.log('🖨️ [PRINT] printOrder() chamado', { 
        contentLength: html?.length, 
        metadata 
      });

      try {
        const result = await ipcRenderer.invoke('print-order', {
          html,
          orderId: metadata.orderId || null,
          timestamp: new Date().toISOString(),
          title: document.title,
          url: window.location.href,
          metadata
        });

        console.log('✅ [PRINT] Pedido enviado para fila:', result.jobId);
        return result;
      } catch (error) {
        console.error('❌ [PRINT] Erro ao enviar pedido:', error.message);
        return { success: false, error: error.message };
      }
    },

    getPrinters: async () => {
      console.log('🖨️ [PRINT] Obtendo lista de impressoras...');
      try {
        const result = await ipcRenderer.invoke('get-printers');
        console.log('✅ [PRINT] Impressoras obtidas:', result.printers?.length);
        return result;
      } catch (error) {
        console.error('❌ [PRINT] Erro ao obter impressoras:', error.message);
        return { success: false, error: error.message };
      }
    },

    setPrinter: async (printerName) => {
      console.log('⚙️ [PRINT] Configurando impressora:', printerName);
      try {
        const result = await ipcRenderer.invoke('set-printer', printerName);
        console.log('✅ [PRINT] Impressora configurada');
        return result;
      } catch (error) {
        console.error('❌ [PRINT] Erro ao configurar impressora:', error.message);
        return { success: false, error: error.message };
      }
    },

    setContentSelectors: async (selectors) => {
      console.log('⚙️ [PRINT] Configurando seletores:', selectors);
      try {
        const result = await ipcRenderer.invoke('set-content-selectors', selectors);
        console.log('✅ [PRINT] Seletores configurados');
        return result;
      } catch (error) {
        console.error('❌ [PRINT] Erro ao configurar seletores:', error.message);
        return { success: false, error: error.message };
      }
    },

    setSilentMode: async (enabled) => {
      console.log('⚙️ [PRINT] Configurando modo silencioso:', enabled);
      try {
        const result = await ipcRenderer.invoke('set-silent-mode', enabled);
        console.log('✅ [PRINT] Modo silencioso configurado');
        return result;
      } catch (error) {
        console.error('❌ [PRINT] Erro ao configurar modo silencioso:', error.message);
        return { success: false, error: error.message };
      }
    },

    setPrinterType: async (printerType) => {
      console.log('⚙️ [PRINT] Configurando tipo de impressora:', printerType);
      try {
        const result = await ipcRenderer.invoke('set-printer-type', printerType);
        console.log('✅ [PRINT] Tipo de impressora configurado');
        return result;
      } catch (error) {
        console.error('❌ [PRINT] Erro ao configurar tipo de impressora:', error.message);
        return { success: false, error: error.message };
      }
    },

    getPrinterConfig: async () => {
      console.log('⚙️ [PRINT] Obtendo configurações da impressora');
      try {
        const result = await ipcRenderer.invoke('get-printer-config');
        console.log('✅ [PRINT] Configurações obtidas');
        return result;
      } catch (error) {
        console.error('❌ [PRINT] Erro ao obter configurações:', error.message);
        return { success: false, error: error.message };
      }
    },

    // ========================= EVENT LISTENERS =========================

    onPrintSuccess: (callback) => {
      console.log('�️ [PRINT] Configurando listener para print-success');
      const handler = (_, data) => {
        console.log('✅ [PRINT] Impressão bem-sucedida:', data.jobId);
        callback(data);
      };
      ipcRenderer.on('print-success', handler);

      return () => {
        console.log('🗑️ [PRINT] Removendo listener print-success');
        ipcRenderer.removeListener('print-success', handler);
      };
    },

    onPrintError: (callback) => {
      console.log('❌ [PRINT] Configurando listener para print-error');
      const handler = (_, data) => {
        console.log('❌ [PRINT] Erro na impressão:', data.jobId);
        callback(data);
      };
      ipcRenderer.on('print-error', handler);

      return () => {
        console.log('🗑️ [PRINT] Removendo listener print-error');
        ipcRenderer.removeListener('print-error', handler);
      };
    },

    onPrintQueueUpdate: (callback) => {
      console.log('📋 [PRINT] Configurando listener para print-queue-update');
      const handler = (_, data) => {
        console.log('� [PRINT] Fila atualizada:', data);
        callback(data);
      };
      ipcRenderer.on('print-queue-update', handler);

      return () => {
        console.log('🗑️ [PRINT] Removendo listener print-queue-update');
        ipcRenderer.removeListener('print-queue-update', handler);
      };
    },

    onPrintJobComplete: (callback) => {
      console.log('🖨️ [PRINT] Configurando listener para print-job-complete');
      const handler = (_, data) => {
        console.log('✅ [PRINT] Job concluído:', data.jobId);
        callback(data);
      };
      ipcRenderer.on('print-job-complete', handler);

      return () => {
        console.log('�️ [PRINT] Removendo listener print-job-complete');
        ipcRenderer.removeListener('print-job-complete', handler);
      };
    },

    // ========================= AUTO UPDATE =========================

    onUpdateStatus: (callback) => {
      console.log('🔄 [UPDATE] Configurando listener para update-status');
      const handler = (_, data) => {
        console.log('🔄 [UPDATE] Status de update:', data.status);
        callback(data);
      };
      ipcRenderer.on('update-status', handler);

      return () => {
        console.log('🗑️ [UPDATE] Removendo listener update-status');
        ipcRenderer.removeListener('update-status', handler);
      };
    },

    onUpdateProgress: (callback) => {
      console.log('📦 [UPDATE] Configurando listener para update-progress');
      const handler = (_, data) => {
        console.log('📦 [UPDATE] Progresso de update:', data.percent + '%');
        callback(data);
      };
      ipcRenderer.on('update-progress', handler);

      return () => {
        console.log('�️ [UPDATE] Removendo listener update-progress');
        ipcRenderer.removeListener('update-progress', handler);
      };
    },

    checkForUpdates: async () => {
      console.log('� [UPDATE] Verificando atualizações...');
      try {
        ipcRenderer.send('check-for-updates');
        console.log('✅ [UPDATE] Verificação iniciada');
        return { success: true };
      } catch (error) {
        console.error('❌ [UPDATE] Erro ao verificar atualizações:', error.message);
        return { success: false, error: error.message };
      }
    },

    installUpdateNow: async () => {
      console.log('🚀 [UPDATE] Instalando atualização...');
      try {
        const result = await ipcRenderer.invoke('install-update-now');
        console.log('✅ [UPDATE] Instalação iniciada');
        return result;
      } catch (error) {
        console.error('❌ [UPDATE] Erro ao instalar atualização:', error.message);
        return { success: false, error: error.message };
      }
    },

    // ========================= HEALTH CHECK =========================

    checkStatus: async () => {
      console.log('🏥 [PRELOAD] Verificando status do sistema...');
      try {
        const result = await ipcRenderer.invoke('health-check');
        console.log('✅ [PRELOAD] Status do sistema:', result);
        return result;
      } catch (error) {
        console.error('❌ [PRELOAD] Erro ao verificar status:', error.message);
        return {
          loaded: true,
          timestamp: new Date().toISOString(),
          version: '1.2.4',
          printerReady: false,
          queueStatus: { length: 0, isPrinting: false },
          error: error.message
        };
      }
    }
  });

  console.log('✅ [PRELOAD] API exposta via contextBridge com sucesso');
} catch (error) {
  console.error('❌ [PRELOAD] Erro ao expor API via contextBridge:', error.message);
  throw error;
}

console.log('✅ [PRELOAD] Preload script concluído');
