import pandas as pd
import numpy as np
import mne
import os

# 1. 讀取並轉換 Emotiv CSV 為 MNE RawArray
def load_emotiv_csv_to_mne(csv_path):
    print(f"Loading EEG CSV Data from {csv_path} ...")
    # 我們的系統匯出 CSV 格式有：['電腦時間', 'Sample', 'AF3', 'T7', 'Pz', 'T8', 'AF4']
    df = pd.read_csv(csv_path)
    
    # 萃取出 EEG 頻道
    ch_names = ['AF3', 'T7', 'Pz', 'T8', 'AF4']
    eeg_data = df[ch_names].values.T  # 轉換為 (n_channels, n_samples)
    
    # 建立 MNE Info 物件 (包含採樣率與頻道名稱)
    sfreq = 128  # Emotiv 採樣率通常為 128Hz 或 256Hz (此處預設 128)
    ch_types = ['eeg'] * len(ch_names)
    info = mne.create_info(ch_names=ch_names, sfreq=sfreq, ch_types=ch_types)
    
    # 建立 RawArray 物件
    raw = mne.io.RawArray(eeg_data, info)
    
    # 載入國際標準 10-20 電極位置對齊
    montage = mne.channels.make_standard_montage('standard_1020')
    raw.set_montage(montage)
    
    return raw

# 1.5 系統直通 API (無須掃描 CSV，直接把陣列塞進來)
def run_analysis_from_data(eeg_data_2d, sfreq=128):
    ch_names = ['AF3', 'T7', 'Pz', 'T8', 'AF4']
    ch_types = ['eeg'] * len(ch_names)
    info = mne.create_info(ch_names=ch_names, sfreq=sfreq, ch_types=ch_types)
    
    # eeg_data_2d 預期是一個 shape 為 (5, n_samples) 的 Array
    eeg_array = np.array(eeg_data_2d)
    raw = mne.io.RawArray(eeg_array, info)
    
    montage = mne.channels.make_standard_montage('standard_1020')
    raw.set_montage(montage)
    
    raw_clean = process_artifacts(raw)
    evoked = analyze_erp(raw_clean)
    run_source_estimation(evoked)
    
    report_file = generate_html_report(raw_clean, evoked)
    return report_file

# 2. 自動淨化與偽影去除 (Automated Artifact Rejection / ICA)
def process_artifacts(raw):
    print("Step 1: 腦波數據自動淨化與偽影去除...")
    # 基礎濾波：帶通濾波 1Hz 到 40Hz (去除基線漂移與高頻市電 50/60Hz 干擾)
    raw_filt = raw.copy().filter(l_freq=1.0, h_freq=40.0, fir_design='firwin')
    
    # 使用 ICA (Independent Component Analysis) 分離偽影 (眨眼、肌肉雜訊)
    # 取前 4 個主成分，因為我們只有 5 個 Channel
    ica = mne.preprocessing.ICA(n_components=4, random_state=42, max_iter='auto')
    ica.fit(raw_filt)
    
    # 【進階】您可以透過 EOG 匹配自動剃除 ICA 成分，此處做示範並實地應用
    # 自動尋找可能像眨眼的 Component (通常會落在額頭附近的 AF3, AF4)
    eog_indices, eog_scores = ica.find_bads_eog(raw_filt, ch_name='AF3', threshold=2.5)
    ica.exclude = eog_indices
    print(f" - 自動檢測到偽影成分 (ICA exclued): {eog_indices}")
    
    # 將乾淨的成分還原到 EEG 中
    raw_clean = ica.apply(raw_filt.copy())
    return raw_clean

# 3. ERP 事件相關電位分析系統 (ERP / Event-Related Potentials)
def analyze_erp(raw_clean):
    print("Step 2: 建立 ERP (事件相關電位) 實驗評估系統...")
    
    # 【模擬 Marker】因為單純儀表板記錄可能沒有 Event Marker，我們在這裡模擬產生隨機的刺激事件
    # 建立 5 個隨機 Event
    samples = raw_clean.n_times
    event_samples = np.linspace(samples * 0.1, samples * 0.9, 5).astype(int)
    events = np.column_stack([event_samples, np.zeros_like(event_samples), np.ones_like(event_samples)])
    
    # 定義 Trigger 的 ID Mapping
    event_id = {'Simulated_Stimulus': 1}
    
    # 切割 Epoch (事件前 0.2 秒到事件後 0.5 秒)
    # 由於只有少數 channel，我們可以直接作平均 (Evoked)
    epochs = mne.Epochs(raw_clean, events, event_id, tmin=-0.2, tmax=0.5, 
                        baseline=(None, 0), preload=True)
    
    # 計算 ERP (Averaging)
    evoked = epochs.average()
    print(" - 成功產生 Evoked Potential (ERP)")
    return evoked

# 4. 偽 3D 大腦皮層電流估計 (Source Estimation / Inverse Modeling)
def run_source_estimation(evoked):
    print("Step 3: 執行偽 3D 大腦皮層電流估計 (Source Estimation / Inverse Operator)...")
    # MNE 內建了 'fsaverage' 作為標準 MRI 腦部模型模板
    # 以下為 Source Estimation 架構骨架，實際執行時需先下載 fsaverage data
    # (mne.datasets.fetch_fsaverage(verbose=True))
    
    fs_dir = mne.datasets.fetch_fsaverage(verbose=False)
    subjects_dir = os.path.dirname(fs_dir)
    subject = 'fsaverage'
    
    print(" - 下載/確認標準大腦模板 (fsaverage) 成功。")
    print(" - (省略耗時的 BEM / Forward 計算，提供核心實作程式碼架構)")
    
    """ 
    # [核心逆運算實作區段] 
    # 實務上處理這段約需要數十秒到幾分鐘進行模型耦合：
    
    # 1. 建立 Source Space
    src = mne.setup_source_space(subject, spacing='oct6', add_dist='patch', subjects_dir=subjects_dir)
    
    # 2. 建立 BEM (大腦電傳導體積模型)
    model = mne.make_bem_model(subject=subject, ico=4, subjects_dir=subjects_dir, conductivity=(0.3,))
    bem = mne.make_bem_solution(model)
    
    # 3. 建立前向模型 (Forward Solution) mapping 電流到 5 個微少電極上
    # trans='fsaverage' 可以快速將標準頭型與我們的電極位置對齊
    fwd = mne.make_forward_solution(evoked.info, trans='fsaverage', src=src, bem=bem)
    
    # 4. 計算逆運算子 (Inverse Operator) 與 Noise Covariance
    noise_cov = mne.compute_covariance(epochs, tmax=0.0) # 取 baseline 的訊號作為雜訊估計
    inverse_operator = mne.minimum_norm.make_inverse_operator(evoked.info, fwd, noise_cov, loose=0.2, depth=0.8)
    
    # 5. 進行電流密度推估 (dSPM: dynamic statistical parametric mapping)
    stc = mne.minimum_norm.apply_inverse(evoked, inverse_operator, lambda2=1./9., method='dSPM')
    
    # 繪製 3D 視覺化
    brain = stc.plot(subject=subject, subjects_dir=subjects_dir, hemi='both', surface='inflated')
    """
    print(" - Inverse Modeling / Source Estimation 藍圖準備完成。")

# 5. 離線高階腦波分析與 HTML 報告產生器 (Advanced EEG Report Generator)
def generate_html_report(raw_clean, evoked):
    print("Step 4: 產生 離線高階腦波分析 HTML 報告 (Report Generator)...")
    
    # 初始化一個 MNE Report
    report = mne.Report(title="Emotiv Advanced EEG Analysis Report")
    
    # 將原始/處理過的 EEG 波形圖加入報告
    fig_raw = raw_clean.plot(show=False)
    report.add_figure(fig_raw, title="Cleaned EEG (ICA + Filtered)", tags=('eeg',))
    
    # 將 PSD (功率譜圖) 加入報告
    fig_psd = raw_clean.compute_psd(fmax=40).plot(show=False)
    report.add_figure(fig_psd, title="Power Spectral Density (PSD)", tags=('psd',))
    
    # 將 ERP (Evoked) 曲線加入報告
    fig_erp = evoked.plot(show=False, spatial_colors=True)
    report.add_figure(fig_erp, title="Event-Related Potentials (ERP)", tags=('erp',))
    
    # 儲存報告
    report_file = 'Emotiv_Advanced_Analysis_Report.html'
    report.save(report_file, overwrite=True, open_browser=False)
    print(f" - > 報告已成功匯出至: {report_file}")
    return report_file

if __name__ == '__main__':
    # 這邊設定一個範例 CSV 路徑。請替換為您從 dashboard 實際下載的 CSV 檔案路徑！
    csv_file_path = 'sample_eeg_export.csv'
    
    if not os.path.exists(csv_file_path):
        print(f"找不到 {csv_file_path}。撰寫一個隨機假資料來驗證腳本執行...")
        # 暫時生成一個假的 CSV 讓指令可以執行驗證
        times = np.arange(0, 10, 1/128)
        sim_data = np.random.randn(len(times), 5) * 20 # uV
        df_sim = pd.DataFrame(sim_data, columns=['AF3', 'T7', 'Pz', 'T8', 'AF4'])
        df_sim.insert(0, 'Sample', np.arange(len(times)))
        df_sim.insert(0, '電腦時間', '2026-03-28T12:00:00')
        df_sim.to_csv(csv_file_path, index=False)
        print("已產生測試用 CSV。")

    # 執行流程
    raw = load_emotiv_csv_to_mne(csv_file_path)
    raw_clean = process_artifacts(raw)
    evoked = analyze_erp(raw_clean)
    run_source_estimation(evoked)
    generate_html_report(raw_clean, evoked)
    
    print("\n🎉 全部高階分析流程執行完畢！您可以開啟 Emotiv_Advanced_Analysis_Report.html 查看報告。")
