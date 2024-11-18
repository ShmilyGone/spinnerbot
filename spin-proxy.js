const fs = require('fs');
const path = require('path');
const axios = require('axios');
const colors = require('colors');
const readline = require('readline');
const { DateTime } = require('luxon');
const { HttpsProxyAgent } = require('https-proxy-agent');

class TimbooAPIClient {
    constructor() {
        this.headers = {
            "Accept": "*/*",
            "Accept-Encoding": "gzip, deflate, br",
            "Accept-Language": "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5",
            "Content-Type": "application/json",
            "Origin": "https://app.spinnercoin.org",
            "Referer": "https://app.spinnercoin.org/",
            "Sec-Ch-Ua": '"Not/A)Brand";v="99", "Google Chrome";v="115", "Chromium";v="115"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "cross-site",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
        };
        this.systemZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        this.proxyList = [];
        this.loadProxies();
    }

    loadProxies() {
        try {
            const proxyFile = path.join(__dirname, 'proxy.txt');
            this.proxyList = fs.readFileSync(proxyFile, 'utf8')
                .replace(/\r/g, '')
                .split('\n')
                .filter(Boolean);
        } catch (error) {
            this.log(`Error loading proxies: ${error.message}`, 'error');
        }
    }

    getAxiosConfig(proxyUrl) {
        if (!proxyUrl) return {};
        
        try {
            const httpsAgent = new HttpsProxyAgent(proxyUrl);
            return {
                httpsAgent,
                proxy: false
            };
        } catch (error) {
            this.log(`Error creating proxy agent: ${error.message}`, 'error');
            return {};
        }
    }

    async checkProxyIP(proxy) {
        try {
            const axiosConfig = this.getAxiosConfig(proxy);
            const response = await axios.get('https://api.ipify.org?format=json', {
                ...axiosConfig,
                headers: this.headers
            });
            
            if (response.status === 200) {
                return response.data.ip;
            } else {
                throw new Error(`Không thể kiểm tra IP của proxy. Status code: ${response.status}`);
            }
        } catch (error) {
            throw new Error(`Error khi kiểm tra IP của proxy: ${error.message}`);
        }
    }

    log(msg, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        switch(type) {
            case 'success':
                console.log(`[${timestamp}] [✓] ${msg}`.green);
                break;
            case 'custom':
                console.log(`[${timestamp}] [*] ${msg}`.magenta);
                break;        
            case 'error':
                console.log(`[${timestamp}] [✗] ${msg}`.red);
                break;
            case 'warning':
                console.log(`[${timestamp}] [!] ${msg}`.yellow);
                break;
            default:
                console.log(`[${timestamp}] [ℹ] ${msg}`.blue);
        }
    }

    async countdown(seconds) {
        for (let i = seconds; i > 0; i--) {
            const timestamp = new Date().toLocaleTimeString();
            readline.cursorTo(process.stdout, 0);
            process.stdout.write(`[${timestamp}] [*] Chờ ${i} giây để tiếp tục...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        readline.cursorTo(process.stdout, 0);
        readline.clearLine(process.stdout, 0);
    }

    async register(initData, proxyUrl) {
        try {
            const axiosConfig = this.getAxiosConfig(proxyUrl);
            const response = await axios.post('https://api.timboo.pro/register', 
                { initData }, 
                {
                    ...axiosConfig,
                    headers: this.headers
                }
            );

            if (response.data.message === 'success') {
                this.log(`Đăng ký thành công cho user ${response.data.user_id}`, 'success');
            } else if (response.data.message === 'User already registered') {
                this.log(`Tài khoản đã được đăng ký`, 'warning');
            }

            return response.data;
        } catch (error) {
            this.log(`Lỗi đăng ký: ${error.message}`, 'error');
            return null;
        }
    }

    async getBoxData(initData, proxyUrl) {
        try {
            const axiosConfig = this.getAxiosConfig(proxyUrl);
            const response = await axios.post('https://api.timboo.pro/get_data', 
                { initData },
                {
                    ...axiosConfig,
                    headers: this.headers
                }
            );

            const boxes = response.data.boxes;
            if (!boxes || boxes.length === 0) return;

            for (const box of boxes) {
                const { canOpen, nextClaimTime, remainingTime } = this.checkBoxOpenable(box);
                
                if (canOpen) {
                    await this.openBox(initData, box.id, proxyUrl);
                } else {
                    const localNextClaimTime = nextClaimTime.setZone(this.systemZone);
                    this.log(`Box ${box.name} - Thời gian claim box tiếp theo: ${localNextClaimTime.toFormat('dd/MM/yyyy HH:mm:ss')} (${this.systemZone}) - Còn ${remainingTime}`, 'warning');
                }
            }
        } catch (error) {
            this.log(`Lỗi lấy thông tin box: ${error.message}`, 'error');
        }
    }

    checkBoxOpenable(box) {
        if (!box.open_time) {
            return { 
                canOpen: true, 
                nextClaimTime: null,
                remainingTime: null
            };
        }

        const openTime = DateTime.fromHTTP(box.open_time);
        const nextClaimTime = openTime.plus({ hours: 7 });
        const currentTime = DateTime.now().setZone('UTC');
        const hoursDiff = currentTime.diff(openTime, 'hours').hours;

        let remainingTime = '';
        if (hoursDiff < 7) {
            const diff = nextClaimTime.diff(currentTime, ['hours', 'minutes', 'seconds']).toObject();
            const hours = Math.floor(diff.hours);
            const minutes = Math.floor(diff.minutes);
            const seconds = Math.floor(diff.seconds);
            
            const parts = [];
            if (hours > 0) parts.push(`${hours} giờ`);
            if (minutes > 0) parts.push(`${minutes} phút`);
            if (seconds > 0) parts.push(`${seconds} giây`);
            remainingTime = parts.join(' ');
        }

        return { 
            canOpen: hoursDiff >= 7,
            nextClaimTime,
            remainingTime
        };
    }

    async openBox(initData, boxId, proxyUrl) {
        try {
            const axiosConfig = this.getAxiosConfig(proxyUrl);
            const response = await axios.post('https://api.timboo.pro/open_box', 
                {
                    initData,
                    boxId
                }, 
                {
                    ...axiosConfig,
                    headers: this.headers
                }
            );

            if (response.data.message === 'ok') {
                const rewardText = response.data.reward_text.replace('<br/>', ' ');
                this.log(`Mở box thành công: ${rewardText}`, 'success');
            }
        } catch (error) {
            this.log(`Lỗi mở box: ${error.message}`, 'error');
        }
    }

    formatSendSwipes(clicks) {
      return clicks * 86559566;
    }

    generateRandomSpins(totalHP) {
        const minSpinsNeeded = Math.ceil(totalHP / 100);
        let spins = Array(minSpinsNeeded).fill(1);
        let remaining = totalHP - minSpinsNeeded;
    
        while (remaining > 0) {
            for (let i = 0; i < spins.length && remaining > 0; i++) {
                const currentValue = spins[i];
                const maxPossibleAdd = Math.min(99 - currentValue, remaining); 
                if (maxPossibleAdd > 0) {
                    const addAmount = Math.floor(Math.random() * maxPossibleAdd) + 1;
                    spins[i] += addAmount;
                    remaining -= addAmount;
                }
            }
        }
    
        if (remaining > 0) {
            spins.push(Math.min(remaining, 99));
            remaining -= Math.min(remaining, 99);
        }
    
        spins = spins.map(spin => Math.min(spin, 99));
        
        remaining = totalHP - spins.reduce((a, b) => a + b, 0);
        while (remaining > 0) {
            for (let i = 0; i < spins.length && remaining > 0; i++) {
                if (spins[i] < 99) {
                    spins[i]++;
                    remaining--;
                }
            }
            if (remaining > 0 && spins.every(spin => spin >= 99)) {
                spins.push(Math.min(remaining, 99));
                remaining -= Math.min(remaining, 99);
            }
        }
    
        return spins;
    }

    async checkSpinnerHP(initData, proxyUrl) {
        try {
            const axiosConfig = this.getAxiosConfig(proxyUrl);
            const response = await axios.post('https://back.timboo.pro/api/init-data', 
                { initData },
                {
                    ...axiosConfig,
                    headers: this.headers
                }
            );

            if (response.data.message === "Data received successfully." && response.data.initData.spinners) {
                const spinner = response.data.initData.spinners[0];
                
                if (spinner.hp === 0) {
                    if (spinner.endRepairTime) {
                        const repairEndTime = DateTime.fromISO(spinner.endRepairTime).setZone(this.systemZone);
                        this.log(`Spin đang trong trạng thái sửa, thời gian kết thúc: ${repairEndTime.toFormat('dd/MM/yyyy HH:mm:ss')} (${this.systemZone})`, 'warning');
                        return false;
                    } else {
                        await this.repairSpinner(initData, proxyUrl);
                        return true;
                    }
                }
                return true;
            }
            return false;
        } catch (error) {
            this.log(`Lỗi kiểm tra spinner HP: ${error.message}`, 'error');
            return false;
        }
    }

    async repairSpinner(initData, proxyUrl) {
        try {
            const axiosConfig = this.getAxiosConfig(proxyUrl);
            const response = await axios.post('https://back.timboo.pro/api/repair-spinner',
                { initData },
                {
                    ...axiosConfig,
                    headers: this.headers
                }
            );

            if (response.data.message === "Data received successfully.") {
                this.log('Sửa spin thành công', 'success');
                return true;
            }
            return false;
        } catch (error) {
            return false;
        }
    }

    async upgradeSpinner(initData, spinnerId, proxyUrl) {
        try {
            const axiosConfig = this.getAxiosConfig(proxyUrl);
            const response = await axios.post('https://back.timboo.pro/api/upgrade-spinner',
                { initData, spinnerId },
                {
                    ...axiosConfig,
                    headers: this.headers
                }
            );

            if (response.data.message === "The spinner is upgraded.") {
                this.log('Nâng cấp spinner thành công', 'success');
                return true;
            }
            return false;
        } catch (error) {
            this.log(`Lỗi nâng cấp spinner: ${error.message}`, 'error');
            return false;
        }
    }

    async checkAndUpgradeSpinner(initData, user, spinner, levels, proxyUrl) {
        const currentLevel = spinner.level;
        const nextLevel = levels.find(level => level.level === currentLevel + 1);
        
        if (nextLevel) {
            this.log(`Level spin hiện tại: ${currentLevel}, Giá level tiếp theo: ${nextLevel.price}`, 'info');
            
            if (user.balance >= nextLevel.price) {
                this.log(`Đủ điều kiện nâng cấp (Balance: ${user.balance} >= ${nextLevel.price})`, 'custom');
                const upgraded = await this.upgradeSpinner(initData, spinner.id, proxyUrl);
                
                if (upgraded) {
                    const response = await this.checkSpinnerHP(initData, proxyUrl);
                    if (response && response.initData) {
                        await this.checkAndUpgradeSpinner(
                            initData,
                            response.initData.user,
                            response.initData.spinners[0],
                            response.initData.levels,
                            proxyUrl
                        );
                    }
                }
            } else {
                this.log(`Không đủ điều kiện nâng cấp (Balance: ${user.balance} < ${nextLevel.price})`, 'warning');
            }
        } else {
            this.log(`Spinner đã đạt cấp độ tối đa: ${currentLevel}`, 'custom');
        }
    }

    async checkSpinnerStatus(initData, proxyUrl, hoinhiemvu, hoinangcap) {
        try {
            const axiosConfig = this.getAxiosConfig(proxyUrl);
            const response = await axios.post('https://back.timboo.pro/api/init-data', 
                { initData },
                {
                    ...axiosConfig,
                    headers: this.headers
                }
            );
            if (response.data.message === "Data received successfully.") {
                if (hoinhiemvu) {
                    if (response.data.initData.sections) {
                        await this.checkAndCompleteTasks(initData, response.data.initData.sections, proxyUrl);
                    }
                }

                const { user, spinners, levels } = response.data.initData;
                this.log(`Balance: ${user.balance}`, 'custom');

                for (const spinner of spinners) {
                    if (spinner.hp > 0 && !spinner.isBroken) {
                        this.log(`Spinner ${spinner.id} có HP: ${spinner.hp}`, 'success');
                        await this.processSpinnerSpins(initData, spinner.hp, proxyUrl);
                    } else {
                        if (spinner.hp === 0) {
                            if (spinner.endRepairTime) {
                                const repairEndTime = DateTime.fromISO(spinner.endRepairTime).setZone(this.systemZone);
                                this.log(`Spin đang trong trạng thái sửa, thời gian kết thúc: ${repairEndTime.toFormat('dd/MM/yyyy HH:mm:ss')} (${this.systemZone})`, 'warning');
                            } else {
                                this.log(`Spinner ${spinner.id} cần sửa`, 'warning');
                                await this.repairSpinner(initData, proxyUrl);
                            }
                        } else {
                            this.log(`Spinner ${spinner.id} đã hỏng hoặc hết HP`, 'warning');
                        }
                    }
                }
                if (hoinangcap) {
                    await this.checkAndUpgradeSpinner(initData, user, spinners[0], levels, proxyUrl);
                }
            }

            return response.data;
        } catch (error) {
            this.log(`Lỗi kiểm tra spinner: ${error.message}`, 'error');
            return null;
        }
    }

    async processSpinnerSpins(initData, totalHP, proxyUrl) {
        let remainingSpins = await this.generateRandomSpins(totalHP);
        this.log(`Chia thành ${remainingSpins.length} lần spin: ${remainingSpins.join(', ')}`, 'custom');
    
        for (let i = 0; i < remainingSpins.length; i++) {
            const currentHP = remainingSpins[i];
            this.log(`Spin lần ${i + 1}/${remainingSpins.length}: ${currentHP} HP`, 'info');
    
            try {
                await this.updateSpinnerData(initData, currentHP, proxyUrl);
                
                const spinnerStatus = await this.getCurrentSpinnerStatus(initData, proxyUrl);
                if (spinnerStatus) {
                    const { currentSpinnerHP } = spinnerStatus;
                    if (currentSpinnerHP === 0) {
                        this.log('Spinner hết HP sau lần spin, tiến hành sửa chữa', 'warning');
                        await this.repairSpinner(initData, proxyUrl);
                        const newStatus = await this.getCurrentSpinnerStatus(initData, proxyUrl);
                        if (newStatus && newStatus.currentSpinnerHP > 0) {
                            const newSpins = await this.generateRandomSpins(newStatus.currentSpinnerHP);
                            remainingSpins = newSpins;
                            this.log(`Tính toán lại lần spin với HP mới (${newStatus.currentSpinnerHP}): ${newSpins.join(', ')}`, 'custom');
                            i = -1;
                            continue;
                        } else {
                            this.log('Không thể tiếp tục spin sau khi sửa chữa', 'error');
                            break;
                        }
                    }
                }
    
                const delay = Math.floor(Math.random() * (7000 - 3000 + 1)) + 3000;
                await new Promise(resolve => setTimeout(resolve, delay));
            } catch (error) {
                if (error.response && error.response.status === 400) {
                    this.log('Gặp lỗi 400, kiểm tra lại spinner HP', 'warning');
                    
                    const spinnerStatus = await this.getCurrentSpinnerStatus(initData, proxyUrl);
                    if (!spinnerStatus) {
                        this.log('Không thể lấy thông tin spinner, dừng quá trình spin', 'error');
                        break;
                    }
    
                    const { currentSpinnerHP, canSpin } = spinnerStatus;
                    
                    if (!canSpin) {
                        this.log('Spinner không thể tiếp tục spin', 'warning');
                        break;
                    }
    
                    if (currentSpinnerHP > 0) {
                        const newSpins = await this.generateRandomSpins(currentSpinnerHP);
                        remainingSpins = newSpins;
                        this.log(`Tính toán lại lần spin với HP mới (${currentSpinnerHP}): ${newSpins.join(', ')}`, 'custom');
                        i = -1;
                    } else {
                        this.log('Spinner hết HP, cần sửa chữa', 'warning');
                        await this.repairSpinner(initData, proxyUrl);
                        const repairedStatus = await this.getCurrentSpinnerStatus(initData, proxyUrl);
                        if (repairedStatus && repairedStatus.currentSpinnerHP > 0) {
                            const newSpins = await this.generateRandomSpins(repairedStatus.currentSpinnerHP);
                            remainingSpins = newSpins;
                            this.log(`Tính toán lại lần spin sau khi sửa chữa (${repairedStatus.currentSpinnerHP}): ${newSpins.join(', ')}`, 'custom');
                            i = -1;
                            continue;
                        } else {
                            break;
                        }
                    }
                } else {
                    break;
                }
            }
        }
        await this.repairSpinner(initData, proxyUrl);
    }

    async getCurrentSpinnerStatus(initData, proxyUrl) {
        try {
            const axiosConfig = this.getAxiosConfig(proxyUrl);
            const response = await axios.post('https://back.timboo.pro/api/init-data', 
                { initData },
                {
                    ...axiosConfig,
                    headers: this.headers
                }
            );

            if (response.data.message === "Data received successfully" && response.data.initData.spinners) {
                const spinner = response.data.initData.spinners[0];
                return {
                    currentSpinnerHP: spinner.hp,
                    canSpin: spinner.hp > 0 && !spinner.isBroken && !spinner.endRepairTime,
                    spinner
                };
            }
            return null;
        } catch (error) {
            this.log(`Lỗi kiểm tra trạng thái spinner: ${error.message}`, 'error');
            return null;
        }
    }

    async watchAd(initData, proxyUrl) {
        try {
            const axiosConfig = this.getAxiosConfig(proxyUrl);
            const startResponse = await axios.post('https://api.timboo.pro/adsgram', 
                { initData },
                {
                    ...axiosConfig,
                    headers: this.headers
                }
            );

            if (startResponse.data.hash) {
                const adHash = startResponse.data.hash;
                this.log(`Bắt đầu xem quảng cáo với hash: ${adHash}`, 'info');

                await this.countdown(15);

                const completeResponse = await axios.post('https://api.timboo.pro/adsgram', 
                    { 
                        initData,
                        hash: adHash
                    },
                    {
                        ...axiosConfig,
                        headers: this.headers
                    }
                );

                if (completeResponse.data.reward) {
                    this.log(`Xem quảng cáo thành công | Phần thưởng ${completeResponse.data.reward} SPN`, 'success');
                    return true;
                }
            }

            return false;
        } catch (error) {
            this.log(`Lỗi xem quảng cáo: ${error.message}`, 'error');
            return false;
        }
    }

    async checkAndCompleteTasks(initData, sections, proxyUrl) {
        try {
            for (const section of sections) {
                this.log(`Đang xử lý nhiệm vụ của mục: ${section.title}`, 'info');
                for (const task of section.tasks) {
                    this.log(`Đang kiểm tra nhiệm vụ: ${task.name} (${task.reward} SPN)`, 'info');
                    
                    if (task.requirements) {
                        for (const req of task.requirements) {
                            try {
                                if (req.id === 115) {
                                    await this.watchAd(initData, proxyUrl);
                                    continue;
                                }

                                const axiosConfig = this.getAxiosConfig(proxyUrl);
                                const response = await axios.post('https://api.timboo.pro/check_requirement', 
                                    { 
                                        initData,
                                        requirementId: req.id 
                                    },
                                    {
                                        ...axiosConfig,
                                        headers: this.headers
                                    }
                                );

                                if (response.data.success) {
                                    this.log(`✓ Hoàn thành: ${req.name} | Phần thưởng ${task.reward} SPN`, 'success');
                                } else {
                                    this.log(`→ Yêu cầu: ${req.name}`, 'warning');
                                    if (req.type === 'tg_subscribe') {
                                        this.log(`  Link Telegram: ${req.tgLink}`, 'custom');
                                    } else if (req.type === 'website' || req.type === 'twitter') {
                                        this.log(`  Link: ${req.websiteUrl}`, 'custom');
                                    } else if (req.type === 'boost') {
                                        this.log(`  Link Boost: ${req.tgLink}`, 'custom');
                                    } else if (req.type === 'league') {
                                        this.log(`  Yêu cầu đạt League ID: ${req.leagueId}`, 'custom');
                                    }
                                }
                                
                                const delay = Math.floor(Math.random() * (5000 - 2000 + 1)) + 2000;
                                await new Promise(resolve => setTimeout(resolve, delay));

                            } catch (error) {
                                if (error.response?.data?.message) {
                                    this.log(`${req.name}: ${error.response.data.message}`, 'warning');
                                } else {
                                    this.log(`Lỗi kiểm tra yêu cầu ${req.name}: ${error.message}`, 'error');
                                }
                            }
                        }
                    }
                    
                    const taskDelay = Math.floor(Math.random() * (7000 - 3000 + 1)) + 3000;
                    await new Promise(resolve => setTimeout(resolve, taskDelay));
                }
            }
        } catch (error) {
            this.log(`Lỗi xử lý nhiệm vụ: ${error.message}`, 'error');
        }
    }

    async updateSpinnerData(initData, newClicks, proxyUrl) {
        let attempts = 0; // Đếm số lần thử
        const maxAttempts = 1; // Số lần thử tối đa
    
        while (attempts < maxAttempts) {
            try {
                const axiosConfig = this.getAxiosConfig(proxyUrl);
                const payload = {
                    initData,
                    data: {
                        timestamp: this.formatSendSwipes(newClicks),
                        isClose: null
                    }
                };
    
                const response = await axios.post('https://back.timboo.pro/api/upd-data',
                    payload,
                    {
                        ...axiosConfig,
                        headers: this.headers
                    }
                );
    
                if (response.status === 200) {
                    this.log(`Cập nhật dữ liệu spinner thành công`, 'success');
                    return response.data;
                }
            } catch (error) {
                attempts++;
                await this.repairSpinner(initData, proxyUrl);
    
                if (attempts >= maxAttempts) {
                    throw new Error(`Cập nhật spinner thất bại sau ${maxAttempts} lần thử`);
                }
            }
        }
    }    

    askQuestion(query) {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        return new Promise(resolve => rl.question(query, ans => {
            rl.close();
            resolve(ans);
        }))
    }

    async main() {
        const dataFile = path.join(__dirname, 'data.txt');
        const data = fs.readFileSync(dataFile, 'utf8')
            .replace(/\r/g, '')
            .split('\n')
            .filter(Boolean);

        this.log('Tool được chia sẻ tại kênh telegram Dân Cày Airdrop (@dancayairdrop)'.green);
        
        const nhiemvu = await this.askQuestion('Bạn có muốn làm nhiệm vụ không? (y/n): ');
        const hoinhiemvu = nhiemvu.toLowerCase() === 'y';

        const nangcap = await this.askQuestion('Bạn có muốn nâng cấp spin không? (y/n): ');
        const hoinangcap = nangcap.toLowerCase() === 'y';

        while (true) {
            for (let i = 0; i < data.length; i++) {
                const initData = data[i];
                const userData = JSON.parse(decodeURIComponent(initData.split('user=')[1].split('&')[0]));
                const firstName = userData.first_name;
                const proxyUrl = this.proxyList[i] || null;

                let proxyIP = 'No proxy';
                try {
                    if (proxyUrl) {
                        proxyIP = await this.checkProxyIP(proxyUrl);
                    }
                } catch (error) {
                    this.log(`Không thể kiểm tra IP proxy: ${error.message}`, 'warning');
                    continue;
                }

                console.log(`========== Tài khoản ${i + 1} | ${firstName.green} | IP: ${proxyIP} ==========`);
                
                await this.register(initData, proxyUrl);
                await this.checkSpinnerStatus(initData, proxyUrl, hoinhiemvu, hoinangcap);
                await this.getBoxData(initData, proxyUrl);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            await this.countdown(7 * 60 * 60);
        }
    }
}

const client = new TimbooAPIClient();
client.main().catch(err => {
  client.log(err.message, 'error');
  process.exit(1);
});