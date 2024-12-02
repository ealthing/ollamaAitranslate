// 在文件最开头添加
// 创建聊天面板
const createChatPanel = () => {
  const panel = document.createElement('div');
  panel.className = 'ai-chat-panel';
  panel.innerHTML = `
    <div class="chat-header">
      <span class="chat-title">AI 助手</span>
      <div class="chat-controls">
        <button class="export-btn" title="导出聊天记录"></button>
        <button class="minimize-btn" title="最小化">_</button>
        <button class="close-btn" title="关闭">×</button>
      </div>
    </div>
    <div class="chat-messages"></div>
    <div class="chat-input-area">
      <textarea placeholder="输入消息..." rows="3"></textarea>
      <button class="send-btn">发送</button>
    </div>
  `;
  document.body.appendChild(panel);
  return panel;
};

// 初始化聊天面板和变量
const chatPanel = createChatPanel();
let selectedContext = '';
let chatHistory = [];

// 添加消息到聊天界面
function addMessage(message, isUser = false) {
  const messagesContainer = chatPanel.querySelector('.chat-messages');
  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-message ${isUser ? 'user-message' : 'ai-message'}`;
  messageDiv.textContent = message;
  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  // 添加到历史记录
  const timestamp = new Date().toISOString();
  chatHistory.push({
    type: isUser ? 'user' : 'ai',
    message: message,
    timestamp: timestamp
  });

  // 保存到 storage
  chrome.storage.local.set({ chatHistory: chatHistory });
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

const scrollHandler = debounce(async () => {
  await translateVisibleTweets();
}, 500);

// 创建翻译弹出框（用于显示翻译中状态）
const createTranslatePopup = () => {
  const popup = document.createElement('div');
  popup.id = 'translate-popup';
  popup.style.display = 'none';
  popup.style.position = 'absolute';
  popup.style.background = 'white';
  popup.style.border = '1px solid #ccc';
  popup.style.padding = '4px 8px';
  popup.style.borderRadius = '4px';
  popup.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
  popup.style.zIndex = '10000';
  popup.style.fontSize = '12px';
  popup.style.color = '#666';
  document.body.appendChild(popup);
  return popup;
};

// 初始化弹出框
const popup = createTranslatePopup();

// 检查扩展连接状态并发送翻译请求
async function sendTranslationRequest(text) {
  let retryCount = 0;
  const maxRetries = 3;
  
  while (retryCount < maxRetries) {
    try {
      if (!chrome.runtime?.id) {
        await new Promise(resolve => setTimeout(resolve, 500));
        retryCount++;
        continue;
      }
      
      const settings = await chrome.storage.local.get(['sourceLang', 'targetLang']);
      const sourceLang = settings.sourceLang || 'auto';
      const targetLang = settings.targetLang || 'zh';
      
      const response = await chrome.runtime.sendMessage({
        type: 'translate',
        text: text,
        sourceLang: sourceLang,
        targetLang: targetLang
      });
      
      return response;
    } catch (error) {
      if (retryCount >= maxRetries - 1) {
        throw error;
      }
      retryCount++;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

// 执行翻译
async function performTranslation() {
  const selection = window.getSelection();
  const selectedText = selection.toString().trim();
  
  if (selectedText) {
    const range = selection.getRangeAt(0);
    
    let currentNode = range.startContainer;
    while (currentNode) {
      if (currentNode.nodeType === Node.ELEMENT_NODE) {
        if (currentNode.classList?.contains('inline-translation') || 
            currentNode.closest('.inline-translation')) {
          return;
        }
      }
      currentNode = currentNode.parentNode;
    }
    
    popup.textContent = '翻译中...';
    popup.style.display = 'block';
    const rect = range.getBoundingClientRect();
    popup.style.left = `${rect.left + window.scrollX}px`;
    popup.style.top = `${rect.bottom + window.scrollY + 5}px`;
    
    try {
      const response = await sendTranslationRequest(selectedText);
      
      if (response.success) {
        popup.style.display = 'none';
        
        const wrapper = document.createElement('span');
        wrapper.style.display = 'inline';
        wrapper.setAttribute('data-original-text', selectedText);
        
        const translatedContainer = document.createElement('div');
        translatedContainer.className = 'inline-translation';
        
        translatedContainer.innerHTML = `
          <div class="translation-header">
            <span class="restore-button">恢复原文</span>
          </div>
          <div class="original-text">${selectedText}</div>
          <div class="translation-text">${response.translation}</div>
          <div class="translation-footer">
            <button class="discuss-button">与 AI 讨论</button>
          </div>
        `;
        
        translatedContainer.querySelector('.restore-button').addEventListener('click', (e) => {
          e.stopPropagation();
          const originalText = document.createTextNode(selectedText);
          wrapper.parentNode.replaceChild(originalText, wrapper);
        });
        
        translatedContainer.querySelector('.discuss-button').addEventListener('click', 
          handleDiscussButtonClick(selectedText, response.translation)
        );
        
        wrapper.appendChild(document.createTextNode(selectedText));
        wrapper.appendChild(translatedContainer);
        
        range.deleteContents();
        range.insertNode(wrapper);
        
        selection.removeAllRanges();
      } else {
        popup.textContent = response.message || '翻译失败，请确保 Ollama 服务正在运行';
      }
    } catch (error) {
      console.error('翻译错误：', error);
      popup.textContent = '翻译失败，请刷新页面后重试。如果问题持续存在，请重新加载扩展。';
      
      setTimeout(() => {
        popup.style.display = 'none';
      }, 3000);
    }
  }
}

// 监听来自 background 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'translateSelection') {
    performTranslation();
  }
});

// 添加选择文本事件监听
document.addEventListener('mouseup', (e) => {
  const isTranslatedContent = e.target.closest('.inline-translation') || 
                             e.target.classList.contains('restore-button') ||
                             e.target.classList.contains('translation-text') ||
                             e.target.parentElement?.classList.contains('inline-translation');
  
  if (isTranslatedContent || e.button === 2) {
    return;
  }

  const selection = window.getSelection().toString().trim();
  if (selection) {
    performTranslation();
  }
});

// 点击其他地方关闭弹出框
document.addEventListener('mousedown', (e) => {
  if (e.target !== popup) {
    popup.style.display = 'none';
  }
});

// 处理页面滚动时隐藏弹窗
document.addEventListener('scroll', () => {
  popup.style.display = 'none';
});

// 翻译功能
async function translateFullPage() {
  // 创建加载提示
  const loadingTip = document.createElement('div');
  loadingTip.className = 'translation-loading-tip';
  loadingTip.textContent = '正在翻译...';
  document.body.appendChild(loadingTip);

  try {
    // 特殊处理推特页面
    if (window.location.hostname.includes('twitter.com') || window.location.hostname.includes('x.com')) {
      const tweets = document.querySelectorAll([
        'article[data-testid="tweet"]',
        'div[data-testid="tweetText"]',
        '.tweet-text'
      ].join(','));

      for (const tweet of tweets) {
        // 检查是否已经有翻译
        if (tweet.querySelector('.paragraph-translation') || 
            tweet.closest('article')?.querySelector('.paragraph-translation')) {
          continue;
        }

        const tweetText = tweet.textContent.trim();
        if (tweetText) {
          loadingTip.textContent = `正在翻译: ${tweetText.slice(0, 30)}...`;
          
          const response = await sendTranslationRequest(tweetText);
          if (response && response.success) {
            const wrapper = document.createElement('div');
            wrapper.className = 'paragraph-translation twitter-translation';
            wrapper.innerHTML = `
              <div class="translation-text">${response.translation}</div>
              <div class="translation-footer">
                <button class="discuss-button">与 AI 讨论</button>
              </div>
            `;

            // 添加讨论按钮事件
            wrapper.querySelector('.discuss-button').addEventListener('click',
              handleDiscussButtonClick(tweetText, response.translation)
            );
            
            // 找到推文的文本容器并在其后插入翻译
            const tweetTextContainer = tweet.querySelector('[data-testid="tweetText"]') || tweet;
            tweetTextContainer.parentNode.insertBefore(wrapper, tweetTextContainer.nextSibling);
          }
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    } else {
      // 处理普通页面
      const mainContent = document.querySelector('article') || document.querySelector('main') || document.body;
      const paragraphs = mainContent.querySelectorAll('p, h1, h2, h3, h4, h5, h6');
      
      for (const paragraph of paragraphs) {
        if (paragraph.querySelector('.paragraph-translation')) {
          continue;
        }

        const text = paragraph.textContent.trim();
        if (text) {
          loadingTip.textContent = `正在翻译: ${text.slice(0, 30)}...`;
          
          const response = await sendTranslationRequest(text);
          if (response && response.success) {
            const wrapper = document.createElement('div');
            wrapper.className = 'paragraph-translation';
            wrapper.innerHTML = `
              <div class="original-text">${text}</div>
              <div class="translation-text">${response.translation}</div>
              <div class="translation-footer">
                <button class="discuss-button">与 AI 讨论</button>
              </div>
            `;

            // 添加讨论按钮事件
            wrapper.querySelector('.discuss-button').addEventListener('click',
              handleDiscussButtonClick(text, response.translation)
            );
            
            paragraph.parentNode.insertBefore(wrapper, paragraph.nextSibling);
          }
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }
  } catch (error) {
    console.error('全文翻译错误：', error);
    alert('翻译过程中出现错误，请重试');
  } finally {
    loadingTip.remove();
  }
}

// 添加样式
const style = document.createElement('style');
style.textContent = `
  .inline-translation {
    display: block;
    margin-top: 4px;
    padding: 4px 6px;
    background: #f8f9fa;
    border-radius: 3px;
    border: 1px solid #e9ecef;
    line-height: 1.5;
    font-size: 14px;
    position: relative;
    max-width: 100%;
    box-sizing: border-box;
  }

  .translation-text {
    color: #1a73e8;
    word-wrap: break-word;
    white-space: pre-wrap;
    max-width: 100%;
    overflow-wrap: break-word;
  }

  .translation-header {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 4px;
    position: absolute;
    top: 4px;
    right: 4px;
    z-index: 1;
  }

  .restore-button {
    font-size: 12px;
    color: #666;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 2px;
    display: none;
    white-space: nowrap;
    background: rgba(255, 255, 255, 0.9);
  }

  .inline-translation:hover .restore-button {
    display: inline-block;
  }

  .restore-button:hover {
    color: #1a73e8;
    background: #e8f0fe;
  }

  .full-page-translate-btn {
    position: fixed;
    right: 20px;
    top: 50%;
    transform: translateY(-50%);
    z-index: 10000;
    cursor: pointer;
  }

  .translate-icon {
    width: 40px;
    height: 40px;
    background: #1a73e8;
    color: white;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    transition: all 0.3s;
  }

  .translate-icon:hover {
    background: #1557b0;
    transform: scale(1.1);
  }

  .translation-loading-tip {
    position: fixed;
    top: 20px;
    right: 70px;
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 8px 16px;
    border-radius: 4px;
    font-size: 14px;
    z-index: 10001;
  }

  .paragraph-translation {
    margin: 10px 0;
    padding: 10px;
    background: #f8f9fa;
    border-left: 3px solid #1a73e8;
    border-radius: 4px;
  }

  .paragraph-translation .original-text {
    color: #333;
    margin-bottom: 8px;
  }

  .paragraph-translation .translation-text {
    color: #1a73e8;
    padding-left: 10px;
    border-left: 2px solid #e9ecef;
  }

  .twitter-translation {
    margin: 8px 0 !important;
    padding: 8px !important;
    background: rgba(247, 249, 250, 0.9) !important;
    border: none !important;
    border-radius: 16px !important;
    width: 100% !important;
    box-sizing: border-box !important;
  }

  .twitter-translation .translation-text {
    color: #1a73e8 !important;
    font-size: 14px !important;
    line-height: 1.4 !important;
  }

  .translation-footer {
    display: flex;
    justify-content: flex-end;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid #e9ecef;
  }

  .discuss-button {
    font-size: 12px;
    color: #1a73e8;
    background: none;
    border: 1px solid #1a73e8;
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .discuss-button:hover {
    background: #1a73e8;
    color: white;
  }

  .ai-chat-panel {
    position: fixed;
    right: 20px;
    bottom: 20px;
    width: 360px;
    height: 500px;
    background: white;
    box-shadow: -2px 0 12px rgba(0,0,0,0.15);
    display: none;
    flex-direction: column;
    z-index: 10000;
    border-radius: 8px;
    border: 1px solid #e9ecef;
    transition: all 0.3s ease;
  }

  .ai-chat-panel.minimized {
    height: 40px !important;
    overflow: hidden;
    cursor: pointer;
  }

  .ai-chat-panel.minimized .chat-header {
    border-radius: 8px;
    padding: 8px 16px;
  }

  .ai-chat-panel.minimized .chat-title::before {
    content: "📋";
    margin-right: 8px;
  }

  .ai-chat-panel.minimized .chat-title::after {
    content: "（点击展开）";
    font-size: 12px;
    margin-left: 8px;
    opacity: 0.8;
  }

  .ai-chat-panel.minimized .chat-messages,
  .ai-chat-panel.minimized .chat-input-area,
  .ai-chat-panel.minimized .export-btn {
    display: none;
  }

  .chat-header {
    padding: 12px 16px;
    background: #1a73e8;
    color: white;
    border-radius: 8px 8px 0 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .chat-title {
    font-size: 14px;
    font-weight: 500;
  }

  .chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    background: white;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .chat-message {
    padding: 8px 12px;
    border-radius: 8px;
    max-width: 80%;
    word-break: break-word;
    line-height: 1.4;
    font-size: 14px;
  }

  .user-message {
    align-self: flex-end;
    background: #e3f2fd;
    color: #1a73e8;
    border-radius: 8px 2px 8px 8px;
  }

  .ai-message {
    align-self: flex-start;
    background: #f5f5f5;
    color: #333;
    border-radius: 2px 8px 8px 8px;
  }

  .chat-input-area {
    padding: 12px;
    border-top: 1px solid #e9ecef;
    background: white;
    border-radius: 0 0 8px 8px;
    z-index: 1;
  }

  .chat-input-area textarea {
    width: 100%;
    padding: 8px;
    border: 1px solid #e9ecef;
    border-radius: 4px;
    resize: none;
    margin-bottom: 8px;
    font-size: 14px;
    line-height: 1.4;
    box-sizing: border-box;
  }

  .chat-input-area button {
    float: right;
    padding: 6px 12px;
    background: #1a73e8;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
  }

  .chat-input-area button:hover {
    background: #1557b0;
  }

  .chat-input-area button:disabled {
    background: #ccc;
    cursor: not-allowed;
  }

  .chat-controls button {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: white;
    cursor: pointer;
    margin-left: 8px;
    border-radius: 4px;
    font-size: 16px;
  }

  .chat-controls button:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .export-btn::after {
    content: "📥";
  }

  .minimized {
    height: 40px !important;
    overflow: hidden;
  }
`;

document.head.appendChild(style);

// 创建并添加翻译按钮
const button = document.createElement('div');
button.className = 'full-page-translate-btn';
button.innerHTML = `<div class="translate-icon" title="翻译全文">译</div>`;
button.addEventListener('click', translateFullPage);
document.body.appendChild(button);

// 修改聊天面板的显示和隐藏
function showChatPanel() {
  chatPanel.style.display = 'flex';
  // 如果是最小化状态，保持最小化
  if (!chatPanel.classList.contains('minimized')) {
    chatPanel.style.height = '500px';
    chatPanel.querySelector('.chat-messages').style.display = 'block';
    chatPanel.querySelector('.chat-input-area').style.display = 'block';
  }
  requestAnimationFrame(() => {
    chatPanel.classList.add('show');
  });
}

function hideChatPanel() {
  chatPanel.classList.remove('show');
  // 等待动画完成后隐藏
  setTimeout(() => {
    chatPanel.style.display = 'none';
  }, 300);
}

// 修改讨论按钮的点击事件处理
function handleDiscussButtonClick(originalText, translatedText) {
  return (e) => {
    e.stopPropagation();
    showChatPanel();
    selectedContext = translatedText;
    addMessage(`原文：${originalText}`);
    addMessage(`译文：${translatedText}`);
    addMessage('你好！我是 AI 助手，很高兴为你提供帮助。我们可以讨论这段内容。');
  };
}

// 修改初始化聊天功能
function initializeChat() {
  const textarea = chatPanel.querySelector('textarea');
  const sendButton = chatPanel.querySelector('.send-btn');
  const minimizeBtn = chatPanel.querySelector('.minimize-btn');
  const closeBtn = chatPanel.querySelector('.close-btn');
  const exportBtn = chatPanel.querySelector('.export-btn');

  // 加载历史记录
  chrome.storage.local.get('chatHistory', (data) => {
    if (data.chatHistory) {
      chatHistory = data.chatHistory;
    }
  });

  // 发送消息
  sendButton.addEventListener('click', async () => {
    const message = textarea.value.trim();
    if (message) {
      addMessage(message, true);
      textarea.value = '';  // 立即清空输入框
      textarea.disabled = true;  // 禁用输入框
      sendButton.disabled = true;  // 禁用发送按钮
      
      try {
        await sendToAI(message);
      } finally {
        textarea.disabled = false;  // 恢复输入框
        sendButton.disabled = false;  // 恢复发送按钮
      }
    }
  });

  // 回车发送消息
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendButton.click();
    }
  });

  // 添加点击最小化状态时展开的功能
  chatPanel.querySelector('.chat-header').addEventListener('click', (e) => {
    // 如果点击的是控制按钮，不处理
    if (e.target.closest('.chat-controls')) {
      return;
    }

    if (chatPanel.classList.contains('minimized')) {
      // 还原聊天框
      chatPanel.classList.remove('minimized');
      minimizeBtn.textContent = '_';
      chatPanel.style.height = '500px';
      // 显示其他元素
      chatPanel.querySelector('.chat-messages').style.display = 'block';
      chatPanel.querySelector('.chat-input-area').style.display = 'block';
      chatPanel.querySelector('.export-btn').style.display = 'block';
    }
  });

  // 修改最小化按钮处理
  minimizeBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // 阻止事件冒泡到 header
    if (chatPanel.classList.contains('minimized')) {
      // 还原聊天框
      chatPanel.classList.remove('minimized');
      minimizeBtn.textContent = '_';
      chatPanel.style.height = '500px';
      // 显示其他元素
      chatPanel.querySelector('.chat-messages').style.display = 'block';
      chatPanel.querySelector('.chat-input-area').style.display = 'block';
      chatPanel.querySelector('.export-btn').style.display = 'block';
    } else {
      // 最小化聊天框
      chatPanel.classList.add('minimized');
      minimizeBtn.textContent = '□';
      chatPanel.style.height = '40px';
      // 隐藏其他元素
      chatPanel.querySelector('.chat-messages').style.display = 'none';
      chatPanel.querySelector('.chat-input-area').style.display = 'none';
      chatPanel.querySelector('.export-btn').style.display = 'none';
    }
  });

  // 关闭按钮
  closeBtn.addEventListener('click', () => {
    hideChatPanel();
    selectedContext = '';
  });

  // 导出按钮
  exportBtn.addEventListener('click', () => {
    // 格式化聊天记录
    let exportText = '聊天记录\n\n';
    chatHistory.forEach(record => {
      const date = new Date(record.timestamp).toLocaleString();
      const speaker = record.type === 'user' ? '用户' : 'AI';
      exportText += `[${date}] ${speaker}:\n${record.message}\n\n`;
    });

    // 创建下载链接
    const blob = new Blob([exportText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-history-${new Date().toISOString().slice(0,10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}

// 确保初始化执行
initializeChat();

// 发送消息到AI
async function sendToAI(message) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'chat',
      text: message,
      context: selectedContext
    });
    
    if (response && response.success) {
      addMessage(response.reply);
    } else {
      addMessage('抱歉，处理消息时出现错误。');
    }
  } catch (error) {
    console.error('发送消息失败：', error);
    addMessage('发送消息失败，请重试。');
  }
}
 