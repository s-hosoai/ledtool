<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-header">
        <span>WebSerial転送（USB直接書き込み）</span>
        <button @click="$emit('close')">✕</button>
      </div>

      <div class="modal-body">
        <!-- 非対応ブラウザ警告 -->
        <div v-if="!isSupported" class="warn-box">
          このブラウザはWebSerial APIに対応していません。Chrome / Edge をご使用ください。
        </div>

        <template v-else>
          <p class="note">
            ESP32のファームウェアが起動3秒以内にUARTアップロードを待機します。<br>
            書き込む前にESP32のENボタンを押してリセットしてください。
          </p>

          <!-- 接続・転送ボタン -->
          <div class="actions">
            <button @click="transfer" :disabled="isTransferring" class="btn-primary">
              {{ isTransferring ? '転送中...' : 'ポートを選択して転送' }}
            </button>
          </div>

          <!-- 進捗バー -->
          <div v-if="isTransferring || progress > 0" class="progress-area">
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: (progress * 100) + '%' }" />
            </div>
            <span class="progress-label">{{ Math.round(progress * 100) }}%</span>
          </div>

          <!-- ステータス -->
          <div v-if="statusMsg" :class="['status', statusType]">{{ statusMsg }}</div>
        </template>
      </div>

      <div class="modal-footer">
        <button @click="$emit('close')">閉じる</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useProject } from '../composables/useProject.js'

defineEmits(['close'])

const { project } = useProject()

const isSupported = 'serial' in navigator
const isTransferring = ref(false)
const progress = ref(0)
const statusMsg = ref('')
const statusType = ref('info')

// アップロードプロトコルマジック
const MAGIC_UP  = new Uint8Array([0x4C, 0x45, 0x55, 0x50]) // "LEUP"
const MAGIC_OK  = new Uint8Array([0x4C, 0x45, 0x4F, 0x4B]) // "LEOK"
const MAGIC_ERR = new Uint8Array([0x4C, 0x45, 0x45, 0x52]) // "LEER"

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

async function readBytes(reader, count, timeoutMs = 3000) {
  const result = new Uint8Array(count)
  let received = 0
  const deadline = Date.now() + timeoutMs
  while (received < count) {
    if (Date.now() > deadline) throw new Error('応答タイムアウト')
    const { value, done } = await reader.read()
    if (done) throw new Error('ポートが閉じられました')
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value)
    for (const b of chunk) { if (received < count) result[received++] = b }
  }
  return result
}

async function transfer() {
  isTransferring.value = true
  progress.value = 0
  statusMsg.value = ''

  let port = null
  try {
    port = await navigator.serial.requestPort()
    await port.open({ baudRate: 115200 })

    const binary = buildBinary()
    const bytes = new Uint8Array(binary)
    const size = bytes.byteLength

    const writer = port.writable.getWriter()
    const reader = port.readable.getReader()

    // ① アップロード開始コマンド: "LEUP" + uint32_t size
    const header = new Uint8Array(8)
    header.set(MAGIC_UP, 0)
    new DataView(header.buffer).setUint32(4, size, true)
    await writer.write(header)

    // ② ESP32 から "LEOK" を待つ（ESP32起動後3秒以内）
    statusMsg.value = 'ESP32の応答待ち... （ENボタンを押してリセットしてください）'
    const resp = await readBytes(reader, 4, 10000)
    if (!resp.every((b, i) => b === MAGIC_OK[i])) {
      throw new Error(`予期しない応答: ${Array.from(resp).map(b => b.toString(16)).join(' ')}`)
    }

    // ③ バイナリデータを送信
    statusMsg.value = 'データ転送中...'
    const CHUNK = 256
    let sent = 0
    while (sent < size) {
      const chunk = bytes.slice(sent, sent + CHUNK)
      await writer.write(chunk)
      sent += chunk.byteLength
      progress.value = sent / size
    }

    // ④ 完了応答を待つ
    const done = await readBytes(reader, 4, 5000)
    if (!done.every((b, i) => b === MAGIC_OK[i])) {
      throw new Error('書き込み確認エラー')
    }

    statusMsg.value = `転送完了（${size} バイト）。ESP32がリセットされます。`
    statusType.value = 'success'

    reader.releaseLock()
    writer.releaseLock()
  } catch (e) {
    statusMsg.value = `エラー：${e.message}`
    statusType.value = 'error'
  } finally {
    if (port) { try { await port.close() } catch (_) {} }
    isTransferring.value = false
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.7);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.modal {
  background: #1e1e1e; border: 1px solid #444; border-radius: 6px;
  width: 480px; max-width: 90vw; display: flex; flex-direction: column;
}
.modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid #333;
  font-size: 14px; font-weight: bold; color: #fff;
}
.modal-header button { background: none; border: none; color: #888; cursor: pointer; font-size: 16px; }
.modal-header button:hover { color: #fff; }
.modal-body { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.warn-box {
  padding: 10px 12px; background: #5a3000; border: 1px solid #a06000;
  border-radius: 4px; font-size: 13px; color: #ffd;
}
.note { font-size: 13px; color: #aaa; line-height: 1.6; }
.actions { display: flex; gap: 8px; }
.btn-primary {
  padding: 6px 18px; background: #2d5a8e; color: #fff;
  border: none; border-radius: 4px; cursor: pointer; font-size: 13px;
}
.btn-primary:hover:not(:disabled) { background: #3a6fa5; }
.btn-primary:disabled { opacity: 0.5; cursor: default; }
.progress-area { display: flex; align-items: center; gap: 10px; }
.progress-bar { flex: 1; height: 8px; background: #333; border-radius: 4px; overflow: hidden; }
.progress-fill { height: 100%; background: #4a9eff; transition: width 0.1s; }
.progress-label { font-size: 12px; color: #aaa; width: 36px; }
.status { padding: 8px 12px; border-radius: 4px; font-size: 13px; }
.status.success { background: #1a3a1a; color: #8f8; border: 1px solid #3a6a3a; }
.status.error   { background: #3a1a1a; color: #f88; border: 1px solid #6a3a3a; }
.status.info    { background: #1a2a3a; color: #8af; border: 1px solid #3a5a7a; }
.modal-footer { padding: 10px 16px; border-top: 1px solid #333; display: flex; justify-content: flex-end; }
.modal-footer button {
  padding: 5px 20px; background: #333; color: #ddd;
  border: 1px solid #555; border-radius: 3px; cursor: pointer; font-size: 13px;
}
.modal-footer button:hover { background: #444; }
</style>
