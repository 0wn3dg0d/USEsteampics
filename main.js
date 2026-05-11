const { app, BrowserWindow, Tray, Menu, ipcMain } = require('electron');
const express = require('express');
const cors = require('cors');
const SteamUser = require('steam-user');
const path = require('path');

let mainWindow;
let tray = null;
let isQuitting = false; // Флаг для полного закрытия

// --- 1. ПЕРЕХВАТ ЛОГОВ ---
// Эта функция отправляет все консольные логи в HTML окно
function sendLog(msg) {
    console.log(msg); // В консоль разраба
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('log-message', msg);
    }
}

// --- 2. ЛОГИКА STEAM СЕРВЕРА ---
function startServer() {
    const serverApp = express();
    const port = 8080;
    serverApp.use(cors());

    const client = new SteamUser();

    sendLog('Подключение к сети Steam...');
    client.logOn({ anonymous: true });

    client.on('loggedOn', () => {
        sendLog('✅ Успешно авторизовано в Steam (анонимно)!');
    });

    serverApp.get('/status', (req, res) => res.json({ active: true }));

    // Принимаем массив ID через параметр ?subids=1,2,3
    serverApp.get('/pics', (req, res) => {
        const subidsParam = req.query.subids;
        if (!subidsParam) return res.status(400).json({ error: 'Не указаны subids' });

        // Разбиваем строку по запятой, превращаем в числа, отсеиваем мусор
        const subids = subidsParam.split(',').map(id => parseInt(id.trim())).filter(id => id);
        
        if (subids.length === 0) return res.status(400).json({ error: 'Нет валидных ID' });

        client.getProductInfo([], subids, true, (err, apps, packages, unknownApps, unknownPackages) => {
            sendLog(`Пакетный запрос PICS для ${subids.length} ID`);
            
            if (err) {
                sendLog(`❌ Ошибка запроса: ${err.message}`);
                return res.status(500).json({ error: err.message });
            }

            let result = {};

            // Обрабатываем найденные пакеты
            if (packages) {
                for (const id of subids) {
                    if (packages[id]) {
                        result[id] = packages[id].packageinfo || packages[id];
                    }
                }
            }

            // Записываем неизвестные пакеты, чтобы скрипт знал, что они закрыты
            if (unknownPackages) {
                for (const id of unknownPackages) {
                    result[id] = { error: 'unknown_package' };
                }
            }

            sendLog(`✅ Возвращено данных для ${Object.keys(result).length} пакетов.`);
            res.json(result);
        });
    });

    serverApp.listen(port, () => {
        sendLog(`Локальный сервер слушает порт http://localhost:${port}`);
    }).on('error', (err) => {
        sendLog(`❌ ОШИБКА ЗАПУСКА: ${err.message}`);
    });
}

// --- 3. ЛОГИКА ОКНА ELECTRON ---
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        backgroundColor: '#1b2838', // Цвет Steam до загрузки HTML
        autoHideMenuBar: true,
        title: "USEsteampics",
		icon: path.join(__dirname, 'build/icon.ico'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.loadFile('index.html');

    // Перехватываем нажатие на крестик
    mainWindow.on('close', function (event) {
        if (!isQuitting) {
            event.preventDefault(); // Отменяем закрытие
            mainWindow.hide();      // Прячем окно
            return false;
        }
    });
}

// --- 4. ЗАПУСК ПРИЛОЖЕНИЯ ---
// Требуется одиночный экземпляр (чтобы не запустить 2 сервера одновременно)
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        // Если кто-то пытается запустить второй exe, разворачиваем первый
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });

    app.whenReady().then(() => {
        createWindow();
        startServer();

        // Создаем иконку в системном трее
        tray = new Tray(path.join(__dirname, 'icon.png'));
        const contextMenu = Menu.buildFromTemplate([
            { label: 'Показать окно', click: () => mainWindow.show() },
            { type: 'separator' },
            { label: 'Выход', click: () => {
                isQuitting = true;
                app.quit();
            }}
        ]);
        tray.setToolTip('USEsteampics Server');
        tray.setContextMenu(contextMenu);

        // Показ по клику на иконку
        tray.on('click', () => {
            mainWindow.show();
        });
    });
}