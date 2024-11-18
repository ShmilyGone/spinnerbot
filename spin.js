const fs = require('fs');
const path = require('path');
const axios = require('axios');
const colors = require('colors');
const readline = require('readline');
const { DateTime } = require('luxon');

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

    async register(initData) {
        try {
            const response = await axios.post('https://api.timboo.pro/register', { initData }, {
                headers: this.headers
            });

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

    async getBoxData(initData) {
        try {
            const response = await axios.post('https://api.timboo.pro/get_data', { initData }, {
                headers: this.headers
            });

            const boxes = response.data.boxes;
            if (!boxes || boxes.length === 0) return;

            for (const box of boxes) {
                const { canOpen, nextClaimTime, remainingTime } = this.checkBoxOpenable(box);
                
                if (canOpen) {
                    await this.openBox(initData, box.id);
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

    async openBox(initData, boxId) {
        try {
            const response = await axios.post('https://api.timboo.pro/open_box', {
                initData,
                boxId
            }, {
                headers: this.headers
            });

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
        let remaining = totalHP - 10;
        let spins = Array(10).fill(1);
        
        while (remaining > 0) {
            const idx = Math.floor(Math.random() * 10);
            const maxAdd = Math.min(99, remaining);
            const addAmount = Math.min(
                Math.floor(Math.random() * maxAdd) + 1,
                remaining
            );
            spins[idx] += addAmount;
            remaining -= addAmount;
        }
        
        return spins;
    }

    async checkSpinnerHP(initData) {
        try {
            const response = await axios.post('https://back.timboo.pro/api/init-data', 
                { initData },
                { headers: this.headers }
            );

            if (response.data.message === "Data received successfully." && response.data.initData.spinners) {
                const spinner = response.data.initData.spinners[0];
                
                if (spinner.hp === 0) {
                    if (spinner.endRepairTime) {
                        const repairEndTime = DateTime.fromISO(spinner.endRepairTime).setZone(this.systemZone);
                        this.log(`Spin đang trong trạng thái sửa, thời gian kết thúc: ${repairEndTime.toFormat('dd/MM/yyyy HH:mm:ss')} (${this.systemZone})`, 'warning');
                        return false;
                    } else {
                        await this.repairSpinner(initData);
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

    async repairSpinner(initData) {
        try {
            const response = await axios.post('https://back.timboo.pro/api/repair-spinner',
                { initData },
                { headers: this.headers }
            );

            if (response.data.message === "Data received successfully.") {
                this.log('Sửa spin thành công', 'success');
                return true;
            }
            return false;
        } catch (error) {
            this.log(`Lỗi sửa spinner: ${error.message}`, 'error');
            return false;
        }
    }

    async upgradeSpinner(initData, spinnerId) {
        try {
            const response = await axios.post('https://back.timboo.pro/api/upgrade-spinner',
                { initData, spinnerId },
                { headers: this.headers }
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

    async checkAndUpgradeSpinner(initData, user, spinner, levels) {
        const currentLevel = spinner.level;
        const nextLevel = levels.find(level => level.level === currentLevel + 1);
        
        if (nextLevel) {
            this.log(`Level spin hiện tại: ${currentLevel}, Giá level tiếp theo: ${nextLevel.price}`, 'info');
            
            if (user.balance >= nextLevel.price) {
                this.log(`Đủ điều kiện nâng cấp (Balance: ${user.balance} >= ${nextLevel.price})`, 'custom');
                const upgraded = await this.upgradeSpinner(initData, spinner.id);
                
                if (upgraded) {
                    const response = await this.checkSpinnerHP(initData);
                    if (response && response.initData) {
                        await this.checkAndUpgradeSpinner(
                            initData,
                            response.initData.user,
                            response.initData.spinners[0],
                            response.initData.levels
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

    async checkSpinnerStatus(initData, hoinhiemvu, hoinangcap) {
        try {
            const response = await axios.post('https://back.timboo.pro/api/init-data', 
                { initData },
                { headers: this.headers }
            );

            if (response.data.message === "Data received successfully.") {
                if (hoinhiemvu) {
                  if (response.data.initData.sections) {
                      await this.checkAndCompleteTasks(initData, response.data.initData.sections);
                  }
                }

                const { user, spinners, levels } = response.data.initData;
                this.log(`Balance: ${user.balance}`, 'custom');

                for (const spinner of spinners) {
                    if (spinner.hp > 0 && !spinner.isBroken) {
                        this.log(`Spinner ${spinner.id} có HP: ${spinner.hp}`, 'success');
                        await this.processSpinnerSpins(initData, spinner.hp);
                    } else {
                        if (spinner.hp === 0) {
                            if (spinner.endRepairTime) {
                                const repairEndTime = DateTime.fromISO(spinner.endRepairTime).setZone(this.systemZone);
                                this.log(`Spin đang trong trạng thái sửa, thời gian kết thúc: ${repairEndTime.toFormat('dd/MM/yyyy HH:mm:ss')} (${this.systemZone})`, 'warning');
                            } else {
                                this.log(`Spinner ${spinner.id} cần sửa`, 'warning');
                                await this.repairSpinner(initData);
                            }
                        } else {
                            this.log(`Spinner ${spinner.id} đã hỏng hoặc hết HP`, 'warning');
                        }
                    }
                }
                if (hoinangcap) {
                  await this.checkAndUpgradeSpinner(initData, user, spinners[0], levels);
                }
            }

            return response.data;
        } catch (error) {
            this.log(`Lỗi kiểm tra spinner: ${error.message}`, 'error');
            return null;
        }
    }

    async processSpinnerSpins(initData, totalHP) {
        let remainingSpins = this.generateRandomSpins(totalHP);
        this.log(`Chia thành 10 lần spin: ${remainingSpins.join(', ')}`, 'custom');

        for (let i = 0; i < remainingSpins.length; i++) {
            const currentHP = remainingSpins[i];
            this.log(`Spin lần ${i + 1}: ${currentHP} HP`, 'info');

            try {
                await this.updateSpinnerData(initData, currentHP);
                
                const spinnerStatus = await this.getCurrentSpinnerStatus(initData);
                if (spinnerStatus) {
                    const { currentSpinnerHP, canSpin } = spinnerStatus;
                    
                    if (currentSpinnerHP === 0) {
                        this.log('Spinner hết HP sau lần spin, tiến hành sửa chữa', 'warning');
                        await this.repairSpinner(initData);
                        
                        const newStatus = await this.getCurrentSpinnerStatus(initData);
                        if (newStatus && newStatus.currentSpinnerHP > 0 && newStatus.canSpin) {
                            const newSpins = this.generateRandomSpins(newStatus.currentSpinnerHP);
                            remainingSpins = newSpins;
                            this.log(`Tính toán lại lần spin sau khi sửa chữa (${newStatus.currentSpinnerHP}): ${newSpins.join(', ')}`, 'custom');
                            i = -1;
                            continue;
                        } else {
                            this.log('Không thể tiếp tục spin sau khi sửa chữa', 'warning');
                            break;
                        }
                    }
                }

                const delay = Math.floor(Math.random() * (7000 - 3000 + 1)) + 3000;
                await new Promise(resolve => setTimeout(resolve, delay));
            } catch (error) {
                if (error.response && error.response.status === 400) {
                    this.log('Gặp lỗi 400, kiểm tra lại spinner HP', 'warning');
                    
                    const spinnerStatus = await this.getCurrentSpinnerStatus(initData);
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
                        const newSpins = this.generateRandomSpins(currentSpinnerHP);
                        remainingSpins = newSpins;
                        this.log(`Tính toán lại lần spin với HP mới (${currentSpinnerHP}): ${newSpins.join(', ')}`, 'custom');
                        i = -1;
                    } else {
                        this.log('Spinner hết HP, cần sửa chữa', 'warning');
                        await this.repairSpinner(initData);
                        
                        const repairedStatus = await this.getCurrentSpinnerStatus(initData);
                        if (repairedStatus && repairedStatus.currentSpinnerHP > 0 && repairedStatus.canSpin) {
                            const newSpins = this.generateRandomSpins(repairedStatus.currentSpinnerHP);
                            remainingSpins = newSpins;
                            this.log(`Tính toán lại lần spin sau khi sửa chữa (${repairedStatus.currentSpinnerHP}): ${newSpins.join(', ')}`, 'custom');
                            i = -1;
                            continue;
                        } else {
                            this.log('Không thể tiếp tục spin sau khi sửa chữa', 'warning');
                            break;
                        }
                    }
                } else {
                    this.log(`Lỗi không xác định khi spin: ${error.message}`, 'error');
                    break;
                }
            }
        }
    }

    async getCurrentSpinnerStatus(initData) {
        try {
            const response = await axios.post('https://back.timboo.pro/api/init-data', 
                { initData },
                { headers: this.headers }
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

    async watchAd(initData) {
        try {
            const startResponse = await axios.post('https://api.timboo.pro/adsgram', 
                { initData },
                { headers: this.headers }
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
                    { headers: this.headers }
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

    async checkAndCompleteTasks(initData, sections) {
        try {
            for (const section of sections) {
                this.log(`Đang xử lý nhiệm vụ của mục: ${section.title}`, 'info');
                for (const task of section.tasks) {
                    this.log(`Đang kiểm tra nhiệm vụ: ${task.name} (${task.reward} SPN)`, 'info');
                    
                    if (task.requirements) {
                        for (const req of task.requirements) {
                            try {
                                if (req.id === 115) {
                                    await this.watchAd(initData);
                                    continue;
                                }

                                const response = await axios.post('https://api.timboo.pro/check_requirement', 
                                    { 
                                        initData,
                                        requirementId: req.id 
                                    },
                                    { headers: this.headers }
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

    async updateSpinnerData(initData, newClicks) {
        try {
            const payload = {
                initData,
                data: {
                    timestamp: this.formatSendSwipes(newClicks),
                    isClose: null
                }
            };

            const response = await axios.post('https://back.timboo.pro/api/upd-data',
                payload,
                { headers: this.headers }
            );

            if (response.status === 200) {
                this.log(`Cập nhật dữ liệu spinner thành công`, 'success');
                await this.repairSpinner(initData);
            }

            return response.data;
        } catch (error) {
            this.log(`Lỗi cập nhật spinner: ${error.message}`, 'error');
            return null;
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

                console.log(`========== Tài khoản ${i + 1} | ${firstName.green} ==========`);
                
                await this.register(initData);
                await this.checkSpinnerStatus(initData, hoinhiemvu, hoinangcap);
                await this.getBoxData(initData);
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