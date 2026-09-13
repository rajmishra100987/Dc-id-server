const express = require('express');
const { MessengerClient, Platform, CookieManager } = require('messagix-js');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Active tasks ko track karne ke liye memory store
const activeTasks = new Map();

// HTML UI Dashboard with E2EE Options
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Messenger Task Manager Panel (E2EE Supported)</title>
            <style>
                body { font-family: Arial, sans-serif; background: #0f172a; color: #f8fafc; padding: 20px; }
                .container { max-width: 700px; margin: auto; background: #1e293b; padding: 20px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.5); }
                input, textarea { width: 100%; padding: 10px; margin: 8px 0; background: #0f172a; border: 1px solid #334155; color: #fff; border-radius: 4px; box-sizing: border-box; }
                .checkbox-group { display: flex; align-items: center; gap: 10px; margin: 10px 0; }
                .checkbox-group input { width: auto; }
                button { background: #3b82f6; color: white; padding: 10px 15px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; }
                button.stop { background: #ef4444; margin-left: 10px; }
                button:hover { opacity: 0.9; }
                .console { background: #000; padding: 15px; border-radius: 4px; height: 250px; overflow-y: auto; font-family: monospace; color: #4ade80; margin-top: 15px; font-size: 13px; }
                .task-box { margin-top: 20px; border-top: 1px solid #334155; padding-top: 15px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>⚡ Messenger Automated Task Panel (E2EE)</h2>
                <form id="taskForm">
                    <label>Messenger Cookies (sb, datr, c_user, xs):</label>
                    <textarea name="cookies" rows="3" placeholder="c_user=...; xs=...;" required></textarea>
                    
                    <label>Group / Thread ID:</label>
                    <input type="text" name="threadId" placeholder="Enter Target Group ID" required>
                    
                    <label>Haters Name (Prefix):</label>
                    <input type="text" name="hatersName" placeholder="Enter Haters Name">
                    
                    <label>Messages List (Ek line me ek message):</label>
                    <textarea name="messages" rows="4" placeholder="Hello&#10;Kaise ho&#10;Test message" required></textarea>
                    
                    <div class="checkbox-group">
                        <input type="checkbox" id="enableE2EE" name="enableE2EE" value="true">
                        <label for="enableE2EE" style="margin:0; cursor:pointer;">Enable End-to-End Encryption (E2EE)</label>
                    </div>

                    <label>E2EE PIN (Agar E2EE Enable kiya hai):</label>
                    <input type="password" name="e2eePin" placeholder="Enter your E2EE PIN if required">

                    <label>Time Delay (Seconds):</label>
                    <input type="number" name="delay" value="5" min="2" required>
                    
                    <button type="submit">Start Task</button>
                </form>

                <div class="task-box">
                    <h3>Task Control & Live Logs</h3>
                    <input type="text" id="activeTaskId" placeholder="Task ID yahan show hogi..." readonly>
                    <button type="button" class="stop" onclick="stopTask()">Stop / Delete Task</button>
                    <div class="console" id="consoleLogs">Waiting for task execution...</div>
                </div>
            </div>

            <script>
                let logInterval;

                document.getElementById('taskForm').addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const formData = new FormData(e.target);
                    const data = Object.fromEntries(formData.entries());
                    
                    // Convert checkbox value to boolean/string properly
                    data.enableE2EE = document.getElementById('enableE2EE').checked;

                    const res = await fetch('/start-task', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data)
                    });
                    const result = await res.json();
                    
                    if(result.success) {
                        document.getElementById('activeTaskId').value = result.taskId;
                        startLogPolling(result.taskId);
                    } else {
                        alert('Error: ' + result.error);
                    }
                });

                function startLogPolling(taskId) {
                    if (logInterval) clearInterval(logInterval);
                    logInterval = setInterval(async () => {
                        const res = await fetch('/logs/' + taskId);
                        const data = await res.json();
                        if(data.logs) {
                            const consoleDiv = document.getElementById('consoleLogs');
                            consoleDiv.innerHTML = data.logs.join('<br>');
                            consoleDiv.scrollTop = consoleDiv.scrollHeight;
                        }
                    }, 1000);
                }

                async function stopTask() {
                    const taskId = document.getElementById('activeTaskId').value;
                    if(!taskId) return alert('Koi active task nahi hai!');
                    
                    const res = await fetch('/stop-task/' + taskId, { method: 'POST' });
                    const result = await res.json();
                    alert(result.message);
                    if(logInterval) clearInterval(logInterval);
                }
            </script>
        </body>
        </html>
    `);
});

// Task Start Endpoint
app.post('/start-task', async (req, res) => {
    const { cookies, threadId, hatersName, messages, delay, enableE2EE, e2eePin } = req.body;
    const taskId = crypto.randomBytes(4).toString('hex');
    
    const messageList = messages.split('\n').map(m => m.trim()).filter(Boolean);
    const logs = [`[${new Date().toLocaleTimeString()}] Task ${taskId} initialized...`];
    
    activeTasks.set(taskId, { logs, status: 'running', interval: null });

    res.json({ success: true, taskId });

    // Background Execution Loop with E2EE params
    executeMessengerTask(taskId, cookies, threadId, hatersName || '', messageList, parseInt(delay) || 5, enableE2EE, e2eePin);
});

// Background Task Function with E2EE Support
async function executeMessengerTask(taskId, cookieStr, threadId, hatersName, messages, delaySec, enableE2EE, e2eePin) {
    const task = activeTasks.get(taskId);
    if (!task) return;

    try {
        task.logs.push(`[${new Date().toLocaleTimeString()}] Parsing cookies & authenticating (E2EE: ${enableE2EE})...`);
        const cookieManager = CookieManager.fromString(Platform.Messenger, cookieStr);
        
        const clientOptions = {
            platform: Platform.Messenger,
            cookies: cookieManager.getAll(),
            enableE2EE: enableE2EE === true || enableE2EE === 'true'
        };

        if (clientOptions.enableE2EE && e2eePin) {
            clientOptions.e2eePin = e2eePin;
        }

        const client = new MessengerClient(clientOptions);

        task.logs.push(`[${new Date().toLocaleTimeString()}] Connecting to messenger.com...`);
        await client.loadMessagesPage();
        await client.connect();

        task.logs.push(`[${new Date().toLocaleTimeString()}] ✓ Messenger Cookie authenticated successfully!`);

        let msgIndex = 0;
        let loopCount = 1;

        const intervalId = setInterval(async () => {
            if (!activeTasks.has(taskId) || task.status === 'stopped') {
                clearInterval(intervalId);
                return;
            }

            if (messages.length === 0) return;

            const rawMsg = messages[msgIndex];
            const finalMessage = hatersName ? `${hatersName} ${rawMsg}` : rawMsg;

            try {
                await client.sendMessage(threadId, finalMessage);
                task.logs.push(`[${new Date().toLocaleTimeString()}] ✓ Sent Loop:${loopCount} Msg[${msgIndex+1}]: ${finalMessage}`);
            } catch (err) {
                task.logs.push(`[${new Date().toLocaleTimeString()}] ❌ Send Error: ${err.message}`);
            }

            msgIndex++;
            if (msgIndex >= messages.length) {
                msgIndex = 0;
                loopCount++;
                task.logs.push(`[${new Date().toLocaleTimeString()}] 🔄 All messages sent. Restarting loop round ${loopCount}...`);
            }

        }, delaySec * 1000);

        task.interval = intervalId;

    } catch (err) {
        task.logs.push(`[${new Date().toLocaleTimeString()}] ❌ Critical Error: ${err.message}`);
        task.status = 'stopped';
    }
}

// Logs fetch endpoint
app.get('/logs/:taskId', (req, res) => {
    const task = activeTasks.get(req.params.taskId);
    if (task) {
        res.json({ logs: task.logs });
    } else {
        res.json({ logs: ['Task not found or stopped.'] });
    }
});

// Stop / Delete Task endpoint
app.post('/stop-task/:taskId', (req, res) => {
    const taskId = req.params.taskId;
    const task = activeTasks.get(taskId);
    if (task) {
        task.status = 'stopped';
        if (task.interval) clearInterval(task.interval);
        activeTasks.delete(taskId);
        res.json({ success: true, message: `Task ${taskId} successfully stopped and deleted!` });
    } else {
        res.status(404).json({ success: false, message: 'Task ID not found!' });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});
