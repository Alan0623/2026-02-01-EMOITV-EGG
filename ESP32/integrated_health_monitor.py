from utime import ticks_ms, ticks_diff
from machine import SoftI2C, Pin, ADC
from max30102 import MAX30102
from pulse_oximeter import Pulse_oximeter, IIR_filter


# ========== 硬體設定 ==========
# LED 指示燈
led = Pin(5, Pin.OUT)
led.value(1)

# MAX30102 感測器 (用於心率和血氧)
my_SCL_pin = 25         # I2C SCL 腳位
my_SDA_pin = 26         # I2C SDA 腳位

i2c = SoftI2C(sda=Pin(my_SDA_pin),
              scl=Pin(my_SCL_pin))

sensor = MAX30102(i2c=i2c)
sensor.setup_sensor()

pox = Pulse_oximeter(sensor)

# 呼吸感測器 (ADC)
adc_pin = Pin(36)
adc = ADC(adc_pin)
adc.width(ADC.WIDTH_10BIT)
adc.atten(ADC.ATTN_11DB)


# ========== 濾波器設定 ==========
dc_extractor = IIR_filter(0.99)         # 用於提取直流成分 (心率)
thresh_generator_hr = IIR_filter(0.9)   # 用於產生動態閾值 (心率)
thresh_generator_rsp = IIR_filter(0.9)  # 用於產生動態閾值 (呼吸)


# ========== 心率相關變數 ==========
is_beating = False             # 紀錄是否正在跳動的旗標
beat_time_mark = ticks_ms()    # 紀錄心跳時間點
heart_rate = 0
num_beats = 0                  # 紀錄心跳次數
target_n_beats = 3             # 設定要幾次心跳才更新一次心率
tot_intval_hr = 0              # 紀錄心跳時間區間
ppg = 0


# ========== 血氧相關變數 ==========
spo2 = 0
spo2_time_mark = ticks_ms()


# ========== 呼吸相關變數 ==========
is_breathing = False           # 紀錄是否正在呼吸的旗標
breath_time_mark = ticks_ms()  # 記錄呼吸的時間點
rsp_rate = 0
num_breath = 0                 # 紀錄呼吸次數
target_n_breath = 2            # 設定幾次呼吸才更新一次呼吸速率
tot_intval_rsp = 0             # 記錄呼吸時間區隔
rsp = 0
rsp_time_mark = ticks_ms()


# ========== 計算函式 ==========
def cal_heart_rate(intval, target_n_beats=3):
    """計算心率"""
    intval /= 1000
    heart_rate = target_n_beats/(intval/60)
    heart_rate = round(heart_rate, 1)
    return heart_rate


def cal_rsp_rate(intval, target_n_breath=2):
    """計算呼吸速率"""
    intval /= 1000
    rsp_rate = target_n_breath/(intval/60)
    rsp_rate = round(rsp_rate, 1)
    return rsp_rate


# (移除 WiFi 與 Web Server 相關設定，改由 USB 直接輸出)



# ========== 主迴圈 ==========
print("整合健康監測系統已啟動 (純 USB 模式)")
print("開始即時輸出健康數據...")

while True:
    # ========== 更新 MAX30102 感測器 (心率和血氧) ==========
    pox.update()
    
    # 處理心率和 PPG 波形
    if pox.available():
        red_val = pox.get_raw_red()
        red_dc = dc_extractor.step(red_val)
        ppg = max(int(red_dc*1.01 - red_val), 0)
        thresh_hr = thresh_generator_hr.step(ppg)
        
        # 檢測心跳
        if ppg > (thresh_hr + 20) and not is_beating:
            is_beating = True
            led.value(0)
            
            intval = ticks_diff(ticks_ms(), beat_time_mark)
            if 2000 > intval > 270:
                tot_intval_hr += intval
                num_beats += 1
                if num_beats == target_n_beats:
                    heart_rate = cal_heart_rate(tot_intval_hr, target_n_beats)
                    print("心率:", heart_rate, "bpm")
                    tot_intval_hr = 0
                    num_beats = 0
            else:
                tot_intval_hr = 0
                num_beats = 0
            beat_time_mark = ticks_ms()
        elif ppg < thresh_hr:
            is_beating = False
            led.value(1)
    
    # 處理血氧濃度
    spo2_tmp = pox.get_spo2()
    spo2_tmp = round(spo2_tmp, 1)
    
    if spo2_tmp > 0:
        spo2_time_mark = ticks_ms()
        spo2 = spo2_tmp
        print("SpO2:", spo2, "%")
    
    # 如果超過5秒沒有有效血氧數據，重置為0
    if ticks_diff(ticks_ms(), spo2_time_mark) > 5000:
        spo2 = 0
    
    
    # ========== 更新呼吸感測器 (每300ms讀取一次) ==========
    if ticks_diff(ticks_ms(), rsp_time_mark) > 300:
        rsp = adc.read()
        thresh_rsp = thresh_generator_rsp.step(rsp)
        
        # 檢測呼吸
        if rsp > (thresh_rsp + 3) and not is_breathing:
            is_breathing = True
            
            intval = ticks_diff(ticks_ms(), breath_time_mark)
            if 60000 > intval > 1000:
                tot_intval_rsp += intval
                num_breath += 1
                if num_breath == target_n_breath:
                    rsp_rate = cal_rsp_rate(tot_intval_rsp, target_n_breath)
                    print("呼吸速率:", rsp_rate, "次/分")
                    tot_intval_rsp = 0
                    num_breath = 0
            else:
                tot_intval_rsp = 0
                num_breath = 0
            breath_time_mark = ticks_ms()
        elif rsp < thresh_rsp:
            is_breathing = False
        
        rsp_time_mark = ticks_ms()  # 重置定時器
