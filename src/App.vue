<template>
  <div class="app">
    <!-- ヘッダー -->
    <header class="app-header">
      <div class="header-left">
        <span class="app-title">LED Pattern Editor</span>
        <input
          class="project-name"
          type="text"
          :value="project.name"
          @change="setProjectName($event.target.value)"
          title="プロジェクト名"
        />
      </div>
      <div class="header-controls">
        <label class="control-item">
          LED数
          <input
            type="number" min="1" max="256"
            :value="project.layout.led_count"
            @change="onLedCountChange($event)"
          />
        </label>
        <label class="control-item">
          FPS
          <input
            type="number" min="1" max="60"
            :value="project.pattern.fps"
            @change="setFps(Number($event.target.value))"
          />
        </label>
        <label class="control-item">
          ループ
          <input
            type="checkbox"
            :checked="project.pattern.loop"
            @change="setLoop($event.target.checked)"
          />
        </label>
        <div class="header-buttons">
          <button @click="newProject">新規</button>
          <button @click="saveProject">保存</button>
          <button @click="triggerLoad">読み込み</button>
          <button class="btn-export" @click="onExport">esptoolで書き込む</button>
          <button class="btn-serial" @click="showSerialModal = true">WebSerial転送</button>
          <input ref="fileInputRef" type="file" accept=".ledproj" style="display:none" @change="onFileLoad" />
        </div>
      </div>
    </header>

    <!-- エラーバナー -->
    <div v-if="errorMessage" class="error-banner">
      {{ errorMessage }}
      <button @click="clearError">✕</button>
    </div>

    <!-- メインエリア（左右分割） -->
    <div class="main-area" ref="mainAreaRef">
      <!-- 左：タイムラインエディタ -->
      <div class="pane pane-left" :style="leftPaneStyle">
        <div class="pane-title">タイムライン</div>
        <TimelineEditor class="pane-content" />
      </div>

      <!-- ドラッグハンドル -->
      <div class="divider" @mousedown="startDividerDrag" title="ドラッグで幅を変更" />

      <!-- 右：シミュレーター / レイアウト タブ -->
      <div class="pane pane-right">
        <div class="pane-tabs">
          <button :class="{ active: rightTab === 'simulator' }" @click="rightTab = 'simulator'">シミュレーター</button>
          <button :class="{ active: rightTab === 'layout' }" @click="rightTab = 'layout'">レイアウト</button>
        </div>
        <Simulator v-show="rightTab === 'simulator'" class="pane-content" />
        <LayoutEditor v-show="rightTab === 'layout'" class="pane-content" />
      </div>
    </div>

    <!-- WebSerial 転送モーダル -->
    <WebSerialTransfer v-if="showSerialModal" @close="showSerialModal = false" />

    <!-- esptool 手順モーダル -->
    <div v-if="showExportModal" class="modal-overlay" @click.self="showExportModal = false">
      <div class="modal">
        <div class="modal-header">
          <span>ESP32への書き込み手順</span>
          <button @click="showExportModal = false">✕</button>
        </div>
        <div class="modal-body">
          <p class="modal-note">
            <strong>{{ exportedFileName }}</strong> をダウンロードしました。<br>
            以下の手順でESP32に書き込んでください。
          </p>

          <div class="step">
            <div class="step-num">1</div>
            <div class="step-content">
              <div class="step-title">ファームウェアのビルド・書き込み（初回のみ）</div>
              <pre class="code">cd firmware/player
idf.py set-target esp32
idf.py -p /dev/ttyUSB0 flash</pre>
              <div class="step-hint">※ ESP32-S3の場合は <code>set-target esp32s3</code></div>
            </div>
          </div>

          <div class="step">
            <div class="step-num">2</div>
            <div class="step-content">
              <div class="step-title">パターンデータの書き込み</div>
              <pre class="code">esptool.py --chip esp32 --port /dev/ttyUSB0 write_flash {{ flashAddrHex }} {{ exportedFileName }}</pre>
              <div class="step-hint">※ ポートはOSによって異なります（Windows: COM3 など）</div>
            </div>
          </div>

          <div class="step">
            <div class="step-num">3</div>
            <div class="step-content">
              <div class="step-title">ESP32をリセット</div>
              <div class="step-hint">書き込み完了後、ENボタンを押してリセットするとパターンが再生されます。</div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button @click="showExportModal = false">閉じる</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onUnmounted } from 'vue'
import { useProject } from './composables/useProject.js'
import TimelineEditor from './components/TimelineEditor.vue'
import Simulator from './components/Simulator.vue'
import LayoutEditor from './components/LayoutEditor.vue'
import WebSerialTransfer from './components/WebSerialTransfer.vue'

const {
  project,
  errorMessage,
  setLedCount,
  setFps,
  setLoop,
  setProjectName,
  loadProject,
  saveProject,
  exportBinary,
  newProject,
  clearError,
  LED_DATA_FLASH_ADDR,
} = useProject()

const fileInputRef = ref(null)
const rightTab = ref('simulator')
const showSerialModal = ref(false)
const showExportModal = ref(false)
const exportedFileName = ref('')
const flashAddrHex = computed(() => `0x${LED_DATA_FLASH_ADDR.toString(16)}`)

function onLedCountChange(e) {
  const v = parseInt(e.target.value)
  if (!isNaN(v)) setLedCount(v)
}

function triggerLoad() {
  fileInputRef.value.value = ''
  fileInputRef.value.click()
}

function onFileLoad(e) {
  const file = e.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (ev) => loadProject(ev.target.result)
  reader.readAsText(file)
}

function onExport() {
  exportBinary()
  exportedFileName.value = `${project.name}.led`
  showExportModal.value = true
}

// 左右分割ドラッグ
const mainAreaRef = ref(null)
const leftWidth = ref(null)
const leftPaneStyle = computed(() =>
  leftWidth.value !== null ? { width: leftWidth.value + 'px' } : { width: '50%' }
)
let isDragging = false
let dragStartX = 0
let dragStartWidth = 0

function startDividerDrag(e) {
  isDragging = true
  dragStartX = e.clientX
  dragStartWidth = leftWidth.value ?? mainAreaRef.value.offsetWidth / 2
  document.addEventListener('mousemove', onDividerMove)
  document.addEventListener('mouseup', stopDividerDrag)
  e.preventDefault()
}

function onDividerMove(e) {
  if (!isDragging || !mainAreaRef.value) return
  const totalW = mainAreaRef.value.offsetWidth - 6
  const newW = Math.max(200, Math.min(totalW - 200, dragStartWidth + (e.clientX - dragStartX)))
  leftWidth.value = newW
}

function stopDividerDrag() {
  isDragging = false
  document.removeEventListener('mousemove', onDividerMove)
  document.removeEventListener('mouseup', stopDividerDrag)
}

onUnmounted(() => {
  document.removeEventListener('mousemove', onDividerMove)
  document.removeEventListener('mouseup', stopDividerDrag)
})
</script>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #111;
  color: #ddd;
  font-family: sans-serif;
  overflow: hidden;
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: #1a1a1a;
  border-bottom: 1px solid #333;
  flex-shrink: 0;
  flex-wrap: wrap;
  gap: 8px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.app-title {
  font-size: 14px;
  font-weight: bold;
  color: #fff;
  white-space: nowrap;
}

.project-name {
  background: #2a2a2a;
  color: #fff;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 2px 8px;
  font-size: 13px;
  width: 200px;
}

.header-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.control-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #aaa;
}

.control-item input[type="number"] {
  width: 54px;
  background: #2a2a2a;
  color: #fff;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 2px 4px;
  font-size: 12px;
}

.header-buttons {
  display: flex;
  gap: 6px;
}

.header-buttons button {
  padding: 3px 12px;
  background: #2d5a8e;
  color: #fff;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
}

.header-buttons button:hover {
  background: #3a6fa5;
}

.btn-export {
  background: #2e7d32 !important;
}

.btn-export:hover {
  background: #388e3c !important;
}

.btn-serial {
  background: #5a3a00 !important;
}

.btn-serial:hover {
  background: #7a5000 !important;
}

.error-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: #7a1f1f;
  color: #fdd;
  font-size: 13px;
  flex-shrink: 0;
}

.error-banner button {
  background: none;
  border: none;
  color: #fdd;
  cursor: pointer;
  font-size: 14px;
  padding: 0 4px;
}

.main-area {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.pane {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 200px;
}

.pane-right {
  flex: 1;
}

.pane-title {
  font-size: 11px;
  color: #666;
  padding: 3px 8px;
  background: #1a1a1a;
  border-bottom: 1px solid #2a2a2a;
  flex-shrink: 0;
  letter-spacing: 0.05em;
}

.pane-tabs {
  display: flex;
  background: #1a1a1a;
  border-bottom: 1px solid #333;
  flex-shrink: 0;
}

.pane-tabs button {
  padding: 4px 14px;
  background: none;
  color: #666;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  font-size: 12px;
  transition: color 0.1s;
}

.pane-tabs button:hover { color: #aaa; }
.pane-tabs button.active { color: #ddd; border-bottom-color: #4a9eff; }

.pane-content {
  flex: 1;
  overflow: hidden;
}

.divider {
  width: 6px;
  background: #222;
  cursor: col-resize;
  flex-shrink: 0;
  border-left: 1px solid #333;
  border-right: 1px solid #333;
  transition: background 0.1s;
}

.divider:hover {
  background: #444;
}

/* モーダル */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal {
  background: #1e1e1e;
  border: 1px solid #444;
  border-radius: 6px;
  width: 560px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #333;
  font-size: 14px;
  font-weight: bold;
  color: #fff;
}

.modal-header button {
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  font-size: 16px;
  padding: 0 4px;
}

.modal-header button:hover { color: #fff; }

.modal-body {
  padding: 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.modal-note {
  font-size: 13px;
  color: #ccc;
  line-height: 1.6;
}

.step {
  display: flex;
  gap: 12px;
}

.step-num {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #2d5a8e;
  color: #fff;
  font-size: 12px;
  font-weight: bold;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 2px;
}

.step-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.step-title {
  font-size: 13px;
  font-weight: bold;
  color: #ddd;
}

.step-hint {
  font-size: 11px;
  color: #888;
}

.code {
  background: #0d0d0d;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 8px 10px;
  font-family: monospace;
  font-size: 12px;
  color: #a8d8a8;
  overflow-x: auto;
  white-space: pre;
  margin: 0;
}

code {
  background: #2a2a2a;
  padding: 1px 5px;
  border-radius: 3px;
  font-family: monospace;
  font-size: 11px;
  color: #aaa;
}

.modal-footer {
  padding: 10px 16px;
  border-top: 1px solid #333;
  display: flex;
  justify-content: flex-end;
}

.modal-footer button {
  padding: 5px 20px;
  background: #333;
  color: #ddd;
  border: 1px solid #555;
  border-radius: 3px;
  cursor: pointer;
  font-size: 13px;
}

.modal-footer button:hover { background: #444; }
</style>
