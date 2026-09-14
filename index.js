const express = require('express');
const { MessengerClient, Platform, CookieManager } = require('messagix-js');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = './tasks.json';

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Anti-Crash System: Server ko marne se bachayega
process.on('uncaughtException', (err) => console.error('[ANTI-CRASH] Uncaught Exception:', err.message));
process.on('unhandledRejection', (reason) => console.error('[ANTI-CRASH] Unhandled Rejection:', reason));

// Active tasks memory
const activeTasks = new Map();

// Helper: Uptime Calculator
function getUptimeString(startTime) {
    const diff = Date.now() - startTime;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${days} Days, ${hours} Hours, ${mins} Mins`;
}

// Database Load & Save Functions
function loadTasks() {
    if (fs.existsSync(DB_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
            for (const [taskId, taskData] of Object.entries(data)) {
                if (taskData.status === 'running') {
                    // Memory me restore karein
                    activeTasks.set(taskId, { ...taskData, interval: null });
                    console.log(`[AUTO-DEPLOY] Restoring Task: ${taskId}`);
                    // Background me auto start kar dein
                    executeMessengerTask(taskId, taskData.cookies, taskData.threadId, taskData.hatersName, taskData.messages, taskData.delaySec);
                }
            }
        } catch (e) {
            console.error("Failed to load tasks.json");
        }
    }
}

function saveTasks() {
    const dataToSave = {};
    for (const [taskId, task] of activeTasks.entries()) {
        dataToSave[taskId] = {
            cookies: task.cookies,
            threadId: task.threadId,
            hatersName: task.hatersName,
            messages: task.messages,
            delaySec: task.delaySec,
            status: task.status,
            startTime: task.startTime,
            // Save only last 50 logs to prevent file from getting too big
            logs: task.logs.slice(-50) 
        };
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(dataToSave, null, 2));
}

// Keep server alive routes
app.head('/', (req, res) => res.status(200).end());
app.get('/ping', (req, res) => res.send('Pong'));

// HTML UI Dashboard (Creamy Pink Theme)
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="hi">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Persistent Task Manager Panel</title>
            <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap" rel="stylesheet">
            <style>
                :root { --bg-cream: #fff0f3; --card-bg: #ffffff; --primary-pink: #ff477e; --primary-hover: #ff1f59; --text-dark: #2b2d42; --border-pink: #ffd1dc; }
                body { font-family: 'Poppins', sans-serif; background: linear-gradient(135deg, #fff0f3 0%, #ffe5ec 100%); color: var(--text-dark); padding: 20px; margin: 0; min-height: 100vh; }
                .container { max-width: 680px; margin: auto; background: var(--card-bg); padding: 30px; border-radius: 20px; box-shadow: 0 15px 35px rgba(255, 105, 135, 0.15); border: 1px solid var(--border-pink); }
                h2 { text-align: center; margin-bottom: 5px; color: var(--text-dark); font-weight: 700; font-size: 24px; }
                .dev-badge { text-align: center; background: linear-gradient(135deg, #ff758c 0%, #ff7eb3 100%); color: white; display: block; padding: 5px 15px; border-radius: 20px; font-size: 12px; font-weight: 600; margin: 0 auto 20px auto; width: fit-content; box-shadow: 0 4px 10px rgba(255, 117, 140, 0.3); }
                label { font-weight: 600; margin-top: 15px; display: block; color: var(--text-dark); font-size: 14px; }
                input, textarea { width: 100%; padding: 12px; margin-top: 6px; border-radius: 10px; border: 1.5px solid var(--border-pink); background: #fff9fa; color: var(--text-dark); box-sizing: border-box; font-family: 'Poppins', sans-serif; font-size: 14px; }
                input:focus, textarea:focus { outline: none; border-color: var(--primary-pink); background: #fff; }
                textarea { height: 90px; resize: vertical; }
                .file-upload-box { margin-top: 6px; background: #fff5f7; border: 1.5px dashed var(--primary-pink); padding: 12px; border-radius: 10px; text-align: center; cursor: pointer; }
                .file-upload-box input[type="file"] { display: none; }
                .file-label { color: var(--primary-pink); font-weight: 500; font-size: 13px; cursor: pointer; }
                button { padding: 14px; border: none; border-radius: 10px; font-weight: 600; cursor: pointer; font-size: 15px; transition: transform 0.2s; width: 100%; margin-top: 15px; color: white; }
                button:active { transform: scale(0.98); }
                .btn-start { background: linear-gradient(135deg, #ff477e 0%, #ff1f59 100%); box-shadow: 0 5px 15px rgba(255, 71, 126, 0.3); }
                .btn-check { background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); box-shadow: 0 5px 15px rgba(59, 130, 246, 0.3); }
                .btn-stop { background: linear-gradient(135deg, #ff6b6b 0%, #ee5253 100%); box-shadow: 0 5px 15px rgba(238, 82, 83, 0.3); }
                .console { background: #1a1a1a; color: #4ade80; padding: 15px; border-radius: 10px; height: 220px; overflow-y: auto; font-family: monospace; font-size: 12px; margin-top: 10px; border: 1px solid #333; }
                .task-box { margin-top: 30px; border-top: 1.5px dashed var(--border-pink); padding-top: 20px; background: #fafafa; padding: 15px; border-radius: 15px;}
                .status-badge { display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: bold; background: #e0f2fe; color: #0284c7; margin-top: 10px;}
            </style>
        </head>
        <body>
            <div class="container">
                <h2>⚡ Auto-Deploy Messenger Bot ⚡</h2>
                <span class="dev-badge">DEVELOPER: RAJ MISHRA</span>
                
                <form id="taskForm">
                    <label>Messenger Cookies:</label>
                    <textarea name="cookies" placeholder="c_user=...; xs=...;" required></textarea>
                    
                    <label>Target ID:</label>
                    <input type="text" name="threadId" placeholder="Enter Target Group ID" required>
                    
                    <label>Haters Name (Prefix):</label>
                    <input type="text" name="hatersName" placeholder="Enter Haters Name">
                    
                    <label>Messages List (.txt or Type manually):</label>
                    <div class="file-upload-box" onclick="document.getElementById('msgFile').click()">
                        <span class="file-label" id="fileLabel">📁 Click to Upload Messages File</span>
                        <input type="file" id="msgFile" accept=".txt" onchange="loadMessageFile(event)">
                    </div>
                    <textarea name="messages" id="messagesBox" placeholder="Hello&#10;Test message" required></textarea>
                    
                    <label>Delay (Seconds):</label>
                    <input type="number" name="delay" value="10" min="2" required>
                    
                    <button type="submit" class="btn-start">🚀 Create & Start Task</button>
                </form>

                <div class="task-box">
                    <h3>🔍 Task Manager & Live Status</h3>
                    <label>Enter Task ID to View/Control:</label>
                    <input type="text" id="manualTaskId" placeholder="Paste Task ID here...">
                    
                    <div style="display: flex; gap: 10px;">
                        <button type="button" class="btn-check" onclick="checkTaskStatus()">👁️ Check Status & Logs</button>
                        <button type="button" class="btn-stop" onclick="deleteTask()">🗑️ Stop & Delete</button>
                    </div>

                    <div id="statusInfo" class="status-badge" style="display:none;"></div>
                    <div class="console" id="consoleLogs">Waiting for Task ID...</div>
                </div>
            </div>

            <script>
                let logInterval;

                function loadMessageFile(event) {
                    const file = event.target.files[0];
                    if (!file) return;
                    document.getElementById('fileLabel').innerText = "📄 Loaded: " + file.name;
                    const reader = new FileReader();
                    reader.onload = e => document.getElementById('messagesBox').value = e.target.result;
                    reader.readAsText(file);
                }

                document.getElementById('taskForm').addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const formData = new FormData(e.target);
                    const data = Object.fromEntries(formData.entries());

                    const res = await fetch('/start-task', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data)
                    });
                    const result = await res.json();
                    
                    if(result.success) {
                        alert("Task Started! Your Task ID is: " + result.taskId + "\\n\\nPlease save this ID to manage the task later.");
                        document.getElementById('manualTaskId').value = result.taskId;
                        checkTaskStatus();
                    } else {
                        alert('Error: ' + result.error);
                    }
                });

                function checkTaskStatus() {
                    const taskId = document.getElementById('manualTaskId').value.trim();
                    if(!taskId) return alert('Pehle Task ID daaliye!');

                    if (logInterval) clearInterval(logInterval);
                    logInterval = setInterval(async () => {
                        try {
                            const res = await fetch('/logs/' + taskId);
                            const data = await res.json();
                            
                            const consoleDiv = document.getElementById('consoleLogs');
                            const statusBadge = document.getElementById('statusInfo');
                            
                            if(data.success) {
                                statusBadge.style.display = "block";
                                statusBadge.innerHTML = \`🟢 Status: \${data.status.toUpperCase()} | ⏱️ Uptime: \${data.uptime}\`;
                                consoleDiv.innerHTML = data.logs.join('<br>');
                                consoleDiv.scrollTop = consoleDiv.scrollHeight;
                            } else {
                                clearInterval(logInterval);
                                statusBadge.style.display = "none";
                                consoleDiv.innerHTML = data.message || "Task not found!";
                            }
                        } catch(err) {}
                    }, 2000); // Check every 2 seconds to save bandwidth
                }

                async function deleteTask() {
                    const taskId = document.getElementById('manualTaskId').value.trim();
                    if(!taskId) return alert('Pehle Task ID daaliye!');
                    
                    if(confirm("Are you sure you want to STOP and DELETE this task permanently?")) {
                        const res = await fetch('/stop-task/' + taskId, { method: 'POST' });
                        const result = await res.json();
                        alert(result.message);
                        if(logInterval) clearInterval(logInterval);
                        document.getElementById('consoleLogs').innerHTML = "Task Deleted.";
                        document.getElementById('statusInfo').style.display = "none";
                    }
                }
            </script>
        </body>
        </html>
    `);
});

// Start Task Endpoint
app.post('/start-task', async (req, res) => {
    const { cookies, threadId, hatersName, messages, delay } = req.body;
    const taskId = crypto.randomBytes(4).toString('hex');
    
    const messageList = messages.split('\n').map(m => m.trim()).filter(Boolean);
    const logs = [`[${new Date().toLocaleTimeString()}] Task ${taskId} Created Successfully.`];
    
    activeTasks.set(taskId, { 
        cookies, threadId, hatersName, 
        messages: messageList, delaySec: parseInt(delay) || 5, 
        logs, status: 'running', interval: null, startTime: Date.now() 
    });

    saveTasks(); // Save to database.json
    res.json({ success: true, taskId });

    // Start Execution
    executeMessengerTask(taskId, cookies, threadId, hatersName || '', messageList, parseInt(delay) || 5);
});

// Background Persistent Execution Task
async function executeMessengerTask(taskId, cookieStr, threadId, hatersName, messages, delaySec) {
    const task = activeTasks.get(taskId);
    if (!task) return;

    try {
        task.logs.push(`[${new Date().toLocaleTimeString()}] Authenticating via messagix-js...`);
        saveTasks();

        const cookieManager = CookieManager.fromString(Platform.Messenger, cookieStr);
        const client = new MessengerClient({ platform: Platform.Messenger, cookies: cookieManager.getAll(), enableE2EE: false });

        await client.loadMessagesPage();
        await client.connect();

        task.logs.push(`[${new Date().toLocaleTimeString()}] ✅ Login Successful. Starting loop...`);
        saveTasks();

        let msgIndex = 0;
        let loopCount = 1;

        const intervalId = setInterval(async () => {
            if (!activeTasks.has(taskId) || task.status === 'stopped') {
                clearInterval(intervalId);
                return;
            }

            const rawMsg = messages[msgIndex];
            const finalMessage = hatersName ? `${hatersName} ${rawMsg}` : rawMsg;

            try {
                await client.sendMessage(threadId, finalMessage);
                task.logs.push(`[${new Date().toLocaleTimeString()}] 🚀 Sent: ${finalMessage}`);
            } catch (err) {
                // Anti-Crash logic: Error log hoga, par loop band nahi hoga
                task.logs.push(`[${new Date().toLocaleTimeString()}] ⚠️ Retry Error: ${err.message}`);
            }

            // Keep log array size manageable
            if(task.logs.length > 50) task.logs.shift();
            saveTasks(); // Save state

            msgIndex++;
            if (msgIndex >= messages.length) {
                msgIndex = 0;
                loopCount++;
                task.logs.push(`[${new Date().toLocaleTimeString()}] 🔄 Restarting Loop (Round ${loopCount})...`);
            }
        }, delaySec * 1000);

        task.interval = intervalId;

    } catch (err) {
        task.logs.push(`[${new Date().toLocaleTimeString()}] ❌ Login Error: ${err.message}. Retrying in 60s...`);
        saveTasks();
        // Auto-Retry if initial connection fails
        setTimeout(() => {
            if(activeTasks.has(taskId) && task.status === 'running') {
                executeMessengerTask(taskId, cookieStr, threadId, hatersName, messages, delaySec);
            }
        }, 60000);
    }
}

// Check Status & Logs Route
app.get('/logs/:taskId', (req, res) => {
    const task = activeTasks.get(req.params.taskId);
    if (task) {
        res.json({ 
            success: true, 
            status: task.status, 
            uptime: getUptimeString(task.startTime),
            logs: task.logs 
        });
    } else {
        res.json({ success: false, message: 'Task ID not found or already deleted.' });
    }
});

// Stop & Delete Task Route
app.post('/stop-task/:taskId', (req, res) => {
    const taskId = req.params.taskId;
    const task = activeTasks.get(taskId);
    if (task) {
        task.status = 'stopped';
        if (task.interval) clearInterval(task.interval);
        activeTasks.delete(taskId);
        saveTasks(); // Update database file
        res.json({ success: true, message: `Task ${taskId} permanently deleted!` });
    } else {
        res.status(404).json({ success: false, message: 'Task ID invalid ya pehle hi delete ho chuka hai!' });
    }
});

// Server Boot Sequence
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SYSTEM LIVE] Server running on port ${PORT} - Developed by Raj Mishra`);
    loadTasks(); // Purane tasks memory me wapas lao aur chalana shuru karo
});
