// 获取本地安装的模型列表
async function fetchLocalModels() {
  const statusElement = document.getElementById('status');
  try {
    statusElement.textContent = '正在检查 Ollama 服务...';
    const response = await fetch('http://localhost:11434/api/tags');
    const data = await response.json();
    statusElement.textContent = 'Ollama 服务正常运行';
    statusElement.style.color = '#4caf50';
    return data.models || [];
  } catch (error) {
    console.error('获取模型列表失败：', error);
    statusElement.textContent = 'Ollama 服务未运行，请启动服务';
    statusElement.style.color = '#f44336';
    return [];
  }
}

// 更新模型选择下拉框
async function updateModelSelect() {
  const select = document.getElementById('model-select');
  const models = await fetchLocalModels();
  
  select.innerHTML = '';
  
  if (models.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Ollama 服务未运行';
    select.appendChild(option);
    select.disabled = true;
    return;
  }
  
  models.forEach(model => {
    const option = document.createElement('option');
    option.value = model.name;
    option.textContent = model.name;
    select.appendChild(option);
  });
  select.disabled = false;
}

// 保存设置
function saveSettings() {
  const apiHost = document.getElementById('api-host').value.trim() || 'http://localhost:11434';
  const selectedModel = document.getElementById('model-select').value;
  const sourceLang = document.getElementById('source-lang').value;
  const targetLang = document.getElementById('target-lang').value;
  const translationColor = document.getElementById('translation-color').value;
  
  // 添加模型参数
  const modelParams = {
    temperature: parseFloat(document.getElementById('temperature').value),
    top_p: parseFloat(document.getElementById('top-p').value),
    max_tokens: parseInt(document.getElementById('max-tokens').value)
  };
  
  chrome.storage.local.set({ 
    apiHost,
    selectedModel,
    sourceLang,
    targetLang,
    translationColor,
    modelParams,
    modelInitialized: true
  }, function() {
    console.log('设置已保存');
    
    // 修改这部分代码，添加错误处理
    chrome.tabs.query({}, function(tabs) {
      tabs.forEach(tab => {
        // 只向 http 和 https 页面发送消息
        if (tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
          chrome.tabs.sendMessage(tab.id, {
            type: 'updateTranslationColor',
            color: translationColor
          }).catch(error => {
            // 忽略连接错误
            console.log('Tab not ready:', tab.id);
          });
        }
      });
    });
  });
}

// 加载设置
async function loadSettings() {
  try {
    await updateModelSelect();
    
    const data = await chrome.storage.local.get([
      'apiHost', 
      'selectedModel', 
      'sourceLang', 
      'targetLang',
      'translationColor',
      'modelParams'
    ]);
    
    if (data.apiHost) {
      document.getElementById('api-host').value = data.apiHost;
    }
    if (data.selectedModel) {
      const modelSelect = document.getElementById('model-select');
      const options = Array.from(modelSelect.options);
      if (options.some(option => option.value === data.selectedModel)) {
        modelSelect.value = data.selectedModel;
      }
    }
    if (data.sourceLang) {
      document.getElementById('source-lang').value = data.sourceLang;
    }
    if (data.targetLang) {
      document.getElementById('target-lang').value = data.targetLang;
    }
    if (data.translationColor) {
      document.getElementById('translation-color').value = data.translationColor;
    }
    
    // 加载模型参数
    if (data.modelParams) {
      const params = data.modelParams;
      if (params.temperature) {
        const tempSlider = document.getElementById('temperature');
        tempSlider.value = params.temperature;
        document.getElementById('temperature-value').textContent = params.temperature;
      }
      if (params.top_p) {
        const topPSlider = document.getElementById('top-p');
        topPSlider.value = params.top_p;
        document.getElementById('top-p-value').textContent = params.top_p;
      }
      if (params.max_tokens) {
        const maxTokensSlider = document.getElementById('max-tokens');
        maxTokensSlider.value = params.max_tokens;
        document.getElementById('max-tokens-value').textContent = params.max_tokens;
      }
    }
  } catch (error) {
    console.error('加载设置失败：', error);
  }
}

// 更新历史记录显示
async function updateHistory() {
  const historyList = document.getElementById('history-list');
  const response = await chrome.runtime.sendMessage({type: 'getHistory'});
  const history = response.history || [];
  
  historyList.innerHTML = '';
  
  history.forEach(item => {
    const historyItem = document.createElement('div');
    historyItem.className = 'history-item';
    
    const sourceText = document.createElement('div');
    sourceText.className = 'source-text';
    sourceText.textContent = item.sourceText;
    
    const translatedText = document.createElement('div');
    translatedText.className = 'translated-text';
    translatedText.textContent = item.translatedText;
    
    const time = document.createElement('div');
    time.className = 'time';
    time.textContent = new Date(item.timestamp).toLocaleString();
    
    historyItem.appendChild(sourceText);
    historyItem.appendChild(translatedText);
    historyItem.appendChild(time);
    historyList.appendChild(historyItem);
  });
}

// 切换历史记录面板
function toggleHistory() {
  const historyPanel = document.getElementById('history-panel');
  const isVisible = historyPanel.style.display !== 'none';
  historyPanel.style.display = isVisible ? 'none' : 'block';
  if (!isVisible) {
    updateHistory();
  }
}

// 清空历史记录
async function clearHistory() {
  await chrome.runtime.sendMessage({type: 'clearHistory'});
  updateHistory();
}

// 事件监听
document.addEventListener('DOMContentLoaded', async function() {
  try {
    await loadSettings();
    
    // 添加事件监听器
    const elements = {
      'api-host': document.getElementById('api-host'),
      'model-select': document.getElementById('model-select'),
      'source-lang': document.getElementById('source-lang'),
      'target-lang': document.getElementById('target-lang'),
      'translation-color': document.getElementById('translation-color'),
      'reset-color': document.getElementById('reset-color')
    };

    // 检查元素是否存在后再添加事件监听
    Object.entries(elements).forEach(([id, element]) => {
      if (element) {
        if (id === 'reset-color') {
          element.addEventListener('click', () => {
            elements['translation-color'].value = '#1a73e8';
            saveSettings();
          });
        } else {
          element.addEventListener('change', saveSettings);
        }
      }
    });

    // 添加滑块值更新事件
    ['temperature', 'top-p', 'max-tokens'].forEach(id => {
      const slider = document.getElementById(id);
      const valueDisplay = document.getElementById(`${id}-value`);
      if (slider && valueDisplay) {
        slider.addEventListener('input', () => {
          valueDisplay.textContent = slider.value;
        });
        slider.addEventListener('change', saveSettings);
      }
    });

    // 添加快捷键提示
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const modKey = isMac ? 'Command' : 'Ctrl';
    document.querySelectorAll('.shortcuts kbd').forEach(kbd => {
      if (kbd.textContent === 'Ctrl') {
        kbd.textContent = modKey;
      }
    });
  } catch (error) {
    console.error('初始化设置失败:', error);
    // 显示错误信息给用户
    const statusElement = document.getElementById('status');
    if (statusElement) {
      statusElement.textContent = '加载设置失败，请重试';
      statusElement.style.color = '#f44336';
    }
  }
}); 