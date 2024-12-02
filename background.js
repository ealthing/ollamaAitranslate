// 监听插件安装和更新事件
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install' || details.reason === 'update') {
    // 设置默认配置
    const defaultConfig = {
      selectedModel: 'qwen:7b',
      apiHost: 'http://localhost:11434',
      modelParams: {
        temperature: 0.7,
        top_p: 0.7,
        max_tokens: 4000
      },
      sourceLang: 'auto',
      targetLang: 'zh'
    };

    await chrome.storage.local.set(defaultConfig);

    // 检查服务和模型状态
    const status = await checkOllamaService(defaultConfig.apiHost, defaultConfig.selectedModel);
    if (!status.success) {
      console.warn('安装提示:', status.message);
    }

    // 向所有已打开的标签页注入脚本
    chrome.tabs.query({}, function(tabs) {
      tabs.forEach(function(tab) {
        // 检查是否是允许注入的页面
        if (tab.url && 
            tab.url.startsWith('http') && 
            !tab.url.startsWith('https://chrome.google.com/') && 
            !tab.url.startsWith('chrome://')) {
          try {
            // 注入脚本
            chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['content.js']
            }).catch(err => {
              // 忽略注入失败的错误
              console.log('注入脚本跳过:', tab.url);
            });

            // 注入样式
            chrome.scripting.insertCSS({
              target: { tabId: tab.id },
              files: ['styles.css']
            }).catch(err => {
              // 忽略注入失败的错误
              console.log('注入样式跳过:', tab.url);
            });
          } catch (error) {
            // 忽略不能注入的页面
            console.log('跳过页面:', tab.url);
          }
        }
      });
    });
  }
});

// 处理来自 content script 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'translate') {
    handleTranslation(request.text, request.sourceLang, request.targetLang)
      .then(response => {
        sendResponse(response);
      })
      .catch(error => {
        console.error('翻译处理失败：', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
  if (request.type === 'chat') {
    handleChatMessage(request.text, request.context)
      .then(response => {
        sendResponse(response);
      })
      .catch(error => {
        console.error('聊天处理失败：', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
});

// 处理翻译请求
async function handleTranslation(text, sourceLang = 'auto', targetLang = 'zh') {
  try {
    const data = await chrome.storage.local.get(['selectedModel', 'apiHost', 'modelParams']);
    const model = data.selectedModel || 'qwen:7b';
    const host = data.apiHost || 'http://localhost:11434';
    const params = data.modelParams || {
      temperature: 0.7,
      top_p: 0.7,
      max_tokens: 4000
    };

    // 检查 Ollama 服务和模型状态
    let serviceStatus = await checkOllamaService(host, model);
    if (!serviceStatus.success) {
      return {
        success: false,
        error: serviceStatus.error,
        message: serviceStatus.message
      };
    }

    const response = await fetch(`${host}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': chrome.runtime.getURL('')
      },
      body: JSON.stringify({
        model: model,
        prompt: `请将以下${getLanguageName(sourceLang)}完整翻译成${getLanguageName(targetLang)}，保持原文的段落格式和语气：\n\n${text}\n\n只需要返回翻译结果，不要其他解释。`,
        stream: false,
        temperature: params.temperature,
        top_p: params.top_p,
        max_tokens: params.max_tokens
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    return { success: true, translation: result.response };
  } catch (error) {
    console.error('翻译错误：', error);
    return { 
      success: false, 
      error: error.message,
      message: '翻译服务出现错误，请刷新页面重试。'
    };
  }
}

// 修改服务检查函数
async function checkOllamaService(host, model) {
  try {
    // 检查服务是否在运行
    const response = await fetch(`${host}/api/tags`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Origin': chrome.runtime.getURL('')
      }
    });

    if (!response.ok) {
      return {
        success: false,
        error: 'service_not_running',
        message: '翻译服务未启动。\n\n请按以下步骤操作：\n1. 确保已安装 Ollama\n2. 打开终端运行 Ollama 服务\n3. 设置环境变量 OLLAMA_ORIGINS="*"\n4. 刷新页面重试'
      };
    }

    const data = await response.json();
    const models = data.models || [];
    
    // 检查模型是否已安装
    if (!models.some(m => m.name === model)) {
      return {
        success: false,
        error: 'model_not_found',
        message: `首次使用需要进行初始化设置：\n\n1. 点击插件图标打开设置\n2. 在"选择翻译模型"下拉框中选择一个可用的模型\n\n完成后即可正常使用。`
      };
    }

    // 即使模型存在，也建议用户进行初始化
    if (!await isModelInitialized()) {
      return {
        success: false,
        error: 'need_initialization',
        message: '首次使用需要初始化：\n\n请点击插件图标，在设置中重新选择一次翻译模型。\n\n这是一个一次性的设置步骤，之后就可以正常使用了。'
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: 'connection_error',
      message: '无法连接到翻译服务。\n\n请检查：\n1. Ollama 服务是否正在运行\n2. 是否正确配置了环境变量\n3. 网络连接是否正常'
    };
  }
}

// 添加模型初始化检查函数
async function isModelInitialized() {
  const data = await chrome.storage.local.get(['modelInitialized']);
  return data.modelInitialized === true;
}

// 修改处理聊天消息的函数
async function handleChatMessage(text, context) {
  try {
    const data = await chrome.storage.local.get(['selectedModel', 'apiHost', 'modelParams']);
    const model = data.selectedModel || 'qwen:7b';
    const host = data.apiHost || 'http://localhost:11434';
    const params = data.modelParams || {
      temperature: 0.7,
      top_p: 0.7,
      max_tokens: 4000
    };

    // 改进提示词，让模型输出更详细的回答
    const prompt = context ? 
      `上下文：${context}\n\n用户：${text}\n\n请提供详细的回答，不要过于简短。` :
      `用户：${text}\n\n请提供详细的回答，不要过于简短。`;

    const response = await fetch(`${host}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        stream: false,
        temperature: params.temperature,
        top_p: params.top_p,
        max_tokens: params.max_tokens
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    return { success: true, reply: result.response };
  } catch (error) {
    console.error('聊天错误：', error);
    return { 
      success: false, 
      error: error.message,
      message: '处理消息时出现错误，请重试'
    };
  }
}

// 获取语言名称
function getLanguageName(code) {
  const languages = {
    'en': '英语',
    'zh': '中文',
    'ja': '日语',
    'ko': '韩语',
    'auto': '自动检测'
  };
  return languages[code] || code;
}

// 监听快捷键
chrome.commands.onCommand.addListener((command) => {
  if (command === 'translate-selection') {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, {type: 'translateSelection'});
    });
  }
}); 