<template>
  <div class="modal-overlay" @click.self="onClose">
    <div class="modal">
      <div class="modal-header">
        <span>WiFi転送（WebSocket）</span>
        <button @click="onClose">✕</button>
      </div>

      <div class="modal-body">
        <!-- 接続設定 -->
        <div class="row">
          <label>ESP32 IPアドレス</label>
          <div class="input-group">
            <input v-model="ipAddr" placeholder="例: 192.168.1.100" :disabled="isConnected" />
            <button v-if="!isConnected" @click="connect" :disabled="isConnecting" class="btn-connect">
              {{ isConnecting ? '接続中...' : '接続' }}
            </button>
            <button v-else @click="disconnect" class="btn-disconnect">切断</button>
          </div>
        </div>

        <!-- 接続状態 -->
        <div :class="['conn-status', connStatusClass]">
          <span class="conn-dot" />
          {{ connStatusText }}
        </div>

        <!-- 操作ボタン -->
        <template v-if="isConnected">
          <div class="actions">
            <button @click="uploadPattern" :disabled="isUploading" class="btn-primary">
              {{ isUploading ? '転送中...' : 'パターンを転送' }}
            </button>
            <button @click="toggleStream" :class="['btn-stream', { active: isStreaming }]">
              {{ isStreaming ? 'リアルタイム停止' : 'リアルタイム配信' }}
            </button>
          </div>

          <!-- 進捗 -->
          <div v-if="isUploading" class="progress-area">
            <div class="progress-bar"><div class="progress-fill" :style="{ width: (uploadProgress * 100) + '%' }" /></div>
            <span class="progress-label">{{ Math.round(uploadProgress * 100) }}%</span>
          </div>

          <!-- リアルタイム情報 -->
          <div v-if="isStreaming" class="stream-info">
            配信中：フレーム {{ streamFrame }} / {{ frameCount - 1 }}
            &nbsp;（{{ project.pattern.fps }} FPS）
          </div>
        </template>

        <!-- ステータスメッセージ -->
        <div v-if="statusMsg" :class="['status', statusType]">{{ statusMsg }}</div>

        <!-- BLE について -->
        <details class="ble-info">
          <summary>BLE転送について</summary>
          <p>
            BLE転送はESP32側のファームウェア（<code>firmware/ble_player/</code>）が別途必要です。<br>
            ブラウザからの転送はChromeのWeb Bluetooth API（実験的機能）を使用します。
            実装は <code>firmware/ble_player/main/main.c</code> のGATTサーバーを参照してください。
          </p>
        </details>
      </div>

      <div class="modal-footer">
        <button @click="onClose">閉じる</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onUnmounted } from 'vue'
import { useProject } from '../composables/useProject.js'

const emit = defineEmits(['close'])

const { project } = useProject()

const ipAddr = ref('')
const isConnecting = ref(false)
const isConnected = ref(false)
const isUploading = ref(false)
const uploadProgress = ref(0)
const isStreaming = ref(false)
const streamFrame = ref(0)
const statusMsg = ref('')
const statusType = ref('info')

const frameCount = computed(() => project.pattern.frame_count)

const connStatusText = computed(() => {
  if (isConnecting.value) return '接続中...'
  if (isConnected.value) return `接続済 ws://${ipAddr.value}/ws`
  return '未接続'
})

const connStatusClass = computed(() => {
  if (isConnected.value) return 'connected'
  if (isConnecting.value) return 'connecting'
  return 'disconnected'
})

let ws = null
let streamTimer = null

function buildBinary() {
  const { fps, loop, frames } = project.pattern
  const ledCount = project.layout.led_count
  const frameCount = frames.length
  const HEADER = 16; const frameSize = ledCount * 3
  const buf = new ArrayBuffer(HEADER + frameSize * frameCount)
  const view = new DataView(buf); const bytes = new Uint8Array(buf)
  view.setUint16(0, 0x4C45, true); view.setUint8(2, 0x01)
  view.setUint8(3, loop ? 0x01 : 0x00)
  view.setUint16(4, ledCount, true); view.setUint16(6, frameCount, true)
  view.setUint8(8, fps)
  for (let f = 0; f < frameCount; f++) {
    for (let l = 0; l < ledCount; l++) {
      const led = frames[f].leds[l]
      const off = HEADER + f * frameSize + l * 3
      bytes[off] = led.g; bytes[off + 1] = led.r; bytes[off + 2] = led.b
    }
  }
  return buf
}

function buildRealtimeFrame(frameIdx) {
  const leds = project.pattern.frames[frameIdx]?.leds ?? []
  const buf = new ArrayBuffer(1 + leds.length * 3)
  const bytes = new Uint8Array(buf)
  bytes[0] = 0xFF  // リアルタイムフレームマーカー
  leds.forEach((led, i) => {
    bytes[1 + i * 3] = led.g
    bytes[1 + i * 3 + 1] = led.r
    bytes[1 + i * 3 + 2] = led.b
  })
  return buf
}

function setStatus(msg, type = 'info') { statusMsg.value = msg; statusType.value = type }

function connect() {
  if (!ipAddr.value) { setStatus('IPアドレスを入力してください', 'error'); return }
  isConnecting.value = true
  setStatus('', 'info')

  ws = new WebSocket(`ws://${ipAddr.value}/ws`)
  ws.binaryType = 'arraybuffer'

  ws.onopen = () => {
    isConnecting.value = false
    isConnected.value = true
    setStatus('接続しました', 'success')
  }

  ws.onmessage = (e) => {
    if (e.data instanceof ArrayBuffer) {
      const bytes = new Uint8Array(e.data)
      // "LEOK": 転送完了確認
      if (bytes[0] === 0x4C && bytes[1] === 0x45 && bytes[2] === 0x4F && bytes[3] === 0x4B) {
        isUploading.value = false
        uploadProgress.value = 1
        setStatus('転送完了。ESP32がパターンを再生します。', 'success')
      }
    }
  }

  ws.onclose = () => {
    isConnecting.value = false
    isConnected.value = false
    stopStream()
    setStatus('切断されました', 'info')
  }

  ws.onerror = () => {
    isConnecting.value = false
    isConnected.value = false
    setStatus(`接続エラー：ws://${ipAddr.value}/ws に接続できませんでした`, 'error')
  }
}

function disconnect() {
  stopStream()
  ws?.close()
}

async function uploadPattern() {
  if (!isConnected.value || !ws) return
  stopStream()
  isUploading.value = true
  uploadProgress.value = 0
  setStatus('パターン転送中...', 'info')

  const binary = buildBinary()
  const bytes = new Uint8Array(binary)
  const CHUNK = 4096

  try {
    let sent = 0
    while (sent < bytes.byteLength) {
      // 送信バッファが溜まっていたら少し待つ
      while (ws.bufferedAmount > 65536) {
        await new Promise(r => setTimeout(r, 16))
      }
      const chunk = bytes.slice(sent, sent + CHUNK)
      ws.send(chunk)
      sent += chunk.byteLength
      uploadProgress.value = sent / bytes.byteLength
    }
    // 完了マーカー送信（ESP32側で全データ受信後にLEOKを返す）
    setStatus('データ送信完了。ESP32の応答待ち...', 'info')
  } catch (e) {
    isUploading.value = false
    setStatus(`転送エラー：${e.message}`, 'error')
  }
}

function startStream() {
  isStreaming.value = true
  streamFrame.value = 0
  const interval = 1000 / project.pattern.fps

  streamTimer = setInterval(() => {
    if (!isConnected.value || !ws || ws.readyState !== WebSocket.OPEN) {
      stopStream(); return
    }
    const buf = buildRealtimeFrame(streamFrame.value)
    ws.send(buf)
    streamFrame.value = (streamFrame.value + 1) % project.pattern.frame_count
  }, interval)
}

function stopStream() {
  isStreaming.value = false
  if (streamTimer) { clearInterval(streamTimer); streamTimer = null }
}

function toggleStream() { isStreaming.value ? stopStream() : startStream() }

function onClose() {
  stopStream()
  if (ws) ws.close()
  emit('close')
}

onUnmounted(() => {
  stopStream()
  if (ws) ws.close()
})
</script>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.7);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.modal {
  background: #1e1e1e; border: 1px solid #444; border-radius: 6px;
  width: 520px; max-width: 90vw; display: flex; flex-direction: column;
}
.modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid #333;
  font-size: 14px; font-weight: bold; color: #fff;
}
.modal-header button { background: none; border: none; color: #888; cursor: pointer; font-size: 16px; }
.modal-header button:hover { color: #fff; }
.modal-body { padding: 16px; display: flex; flex-direction: column; gap: 14px; }

.row { display: flex; flex-direction: column; gap: 5px; }
.row label { font-size: 12px; color: #aaa; }
.input-group { display: flex; gap: 8px; }
.input-group input {
  flex: 1; background: #2a2a2a; color: #fff;
  border: 1px solid #444; border-radius: 3px; padding: 5px 8px; font-size: 13px;
}
.input-group input:disabled { opacity: 0.5; }

.btn-connect, .btn-disconnect {
  padding: 5px 14px; border: none; border-radius: 3px; cursor: pointer; font-size: 13px;
}
.btn-connect { background: #2d5a8e; color: #fff; }
.btn-connect:hover:not(:disabled) { background: #3a6fa5; }
.btn-connect:disabled { opacity: 0.5; cursor: default; }
.btn-disconnect { background: #5a2020; color: #fdd; }
.btn-disconnect:hover { background: #7a3030; }

.conn-status {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; padding: 6px 10px; border-radius: 4px;
}
.conn-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.conn-status.connected   { background: #1a3a1a; color: #8f8; }
.conn-status.connected   .conn-dot { background: #4f4; }
.conn-status.connecting  { background: #3a3a1a; color: #ff8; }
.conn-status.connecting  .conn-dot { background: #ff4; }
.conn-status.disconnected { background: #2a2a2a; color: #888; }
.conn-status.disconnected .conn-dot { background: #555; }

.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.btn-primary {
  padding: 6px 18px; background: #2d5a8e; color: #fff;
  border: none; border-radius: 4px; cursor: pointer; font-size: 13px;
}
.btn-primary:hover:not(:disabled) { background: #3a6fa5; }
.btn-primary:disabled { opacity: 0.5; cursor: default; }
.btn-stream {
  padding: 6px 18px; background: #333; color: #ddd;
  border: 1px solid #555; border-radius: 4px; cursor: pointer; font-size: 13px;
}
.btn-stream:hover { background: #444; }
.btn-stream.active { background: #5a2060; color: #fdf; border-color: #8a40a0; }

.progress-area { display: flex; align-items: center; gap: 10px; }
.progress-bar { flex: 1; height: 8px; background: #333; border-radius: 4px; overflow: hidden; }
.progress-fill { height: 100%; background: #4a9eff; transition: width 0.1s; }
.progress-label { font-size: 12px; color: #aaa; width: 36px; }

.stream-info { font-size: 12px; color: #a88; padding: 4px 0; }

.status { padding: 8px 12px; border-radius: 4px; font-size: 13px; }
.status.success { background: #1a3a1a; color: #8f8; border: 1px solid #3a6a3a; }
.status.error   { background: #3a1a1a; color: #f88; border: 1px solid #6a3a3a; }
.status.info    { background: #1a2a3a; color: #8af; border: 1px solid #3a5a7a; }

.ble-info { margin-top: 4px; }
.ble-info summary { font-size: 12px; color: #666; cursor: pointer; }
.ble-info summary:hover { color: #999; }
.ble-info p { font-size: 12px; color: #666; line-height: 1.6; margin: 8px 0 0; }
.ble-info code { background: #2a2a2a; padding: 1px 5px; border-radius: 3px; font-size: 11px; }

.modal-footer { padding: 10px 16px; border-top: 1px solid #333; display: flex; justify-content: flex-end; }
.modal-footer button {
  padding: 5px 20px; background: #333; color: #ddd;
  border: 1px solid #555; border-radius: 3px; cursor: pointer; font-size: 13px;
}
.modal-footer button:hover { background: #444; }
</style>
