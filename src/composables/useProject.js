import { reactive, readonly, computed } from 'vue'

const DEFAULT_LED_COUNT = 10
const DEFAULT_FRAME_COUNT = 10
const DEFAULT_FPS = 10

// 全フレーム×全LED分のフレームデータを生成（全セル黒で初期化）
function createFrames(ledCount, frameCount) {
  return Array.from({ length: frameCount }, (_, frameIdx) => ({
    frame: frameIdx,
    leds: Array.from({ length: ledCount }, (_, id) => ({ id, r: 0, g: 0, b: 0 })),
  }))
}

function createNewProject() {
  return {
    version: 1,
    name: '新規プロジェクト',
    layout: {
      led_count: DEFAULT_LED_COUNT,
      leds: Array.from({ length: DEFAULT_LED_COUNT }, (_, id) => ({
        id,
        x: 50 + id * 40,
        y: 100,
      })),
    },
    pattern: {
      fps: DEFAULT_FPS,
      loop: true,
      frame_count: DEFAULT_FRAME_COUNT,
      frames: createFrames(DEFAULT_LED_COUNT, DEFAULT_FRAME_COUNT),
    },
  }
}

const state = reactive({
  project: createNewProject(),
  errorMessage: null,
})

// LED(id, frame)の色を設定
function setLedColor(frameIdx, ledId, r, g, b) {
  const led = state.project.pattern.frames[frameIdx].leds[ledId]
  if (!led) return
  led.r = r
  led.g = g
  led.b = b
}

// 指定フレーム×LED範囲に色を一括設定
function fillRange(frameStart, frameEnd, ledStart, ledEnd, r, g, b) {
  for (let f = frameStart; f <= frameEnd; f++) {
    for (let l = ledStart; l <= ledEnd; l++) {
      setLedColor(f, l, r, g, b)
    }
  }
}

// フレームをコピーして指定位置の後ろに挿入
function insertFrame(afterIdx, sourceFrameIdx) {
  const src = state.project.pattern.frames[sourceFrameIdx]
  const newFrame = {
    frame: afterIdx + 1,
    leds: src.leds.map(l => ({ ...l })),
  }
  state.project.pattern.frames.splice(afterIdx + 1, 0, newFrame)
  // frame番号を振り直す
  state.project.pattern.frames.forEach((f, i) => { f.frame = i })
  state.project.pattern.frame_count = state.project.pattern.frames.length
}

// フレームを末尾に追加（黒で初期化）
function addFrame() {
  const ledCount = state.project.layout.led_count
  const newIdx = state.project.pattern.frames.length
  state.project.pattern.frames.push({
    frame: newIdx,
    leds: Array.from({ length: ledCount }, (_, id) => ({ id, r: 0, g: 0, b: 0 })),
  })
  state.project.pattern.frame_count = state.project.pattern.frames.length
}

// フレームを削除
function deleteFrame(frameIdx) {
  if (state.project.pattern.frames.length <= 1) return
  state.project.pattern.frames.splice(frameIdx, 1)
  state.project.pattern.frames.forEach((f, i) => { f.frame = i })
  state.project.pattern.frame_count = state.project.pattern.frames.length
}

// フレームをコピー（内部クリップボード）
let copiedFrame = null
function copyFrame(frameIdx) {
  copiedFrame = state.project.pattern.frames[frameIdx].leds.map(l => ({ ...l }))
}

function pasteFrame(frameIdx) {
  if (!copiedFrame) return
  state.project.pattern.frames[frameIdx].leds = copiedFrame.map(l => ({ ...l }))
}

// LED数変更：既存IDのデータを引継ぎ、増加分は黒で初期化
function setLedCount(newCount) {
  if (newCount < 1 || newCount > 256) return
  const oldCount = state.project.layout.led_count
  state.project.layout.led_count = newCount

  // レイアウト更新
  if (newCount > oldCount) {
    for (let id = oldCount; id < newCount; id++) {
      state.project.layout.leds.push({ id, x: 50 + id * 40, y: 100 })
    }
  } else {
    state.project.layout.leds = state.project.layout.leds.slice(0, newCount)
  }

  // フレームデータ更新
  state.project.pattern.frames.forEach(frame => {
    if (newCount > oldCount) {
      for (let id = oldCount; id < newCount; id++) {
        frame.leds.push({ id, r: 0, g: 0, b: 0 })
      }
    } else {
      frame.leds = frame.leds.slice(0, newCount)
    }
  })
}

function setFps(fps) {
  state.project.pattern.fps = Math.max(1, Math.min(60, fps))
}

function setLoop(loop) {
  state.project.pattern.loop = loop
}

function setProjectName(name) {
  state.project.name = name
}

// プロジェクトファイルのバリデーション
function validateProject(obj) {
  if (typeof obj !== 'object' || obj === null) throw new Error('無効なJSONです')
  if (obj.version !== 1) throw new Error(`未対応のバージョンです: ${obj.version}`)
  if (!obj.layout || typeof obj.layout.led_count !== 'number') throw new Error('layout.led_count が不正です')
  if (!Array.isArray(obj.layout.leds)) throw new Error('layout.leds が不正です')
  if (!obj.pattern || typeof obj.pattern.fps !== 'number') throw new Error('pattern.fps が不正です')
  if (typeof obj.pattern.frame_count !== 'number') throw new Error('pattern.frame_count が不正です')
  if (!Array.isArray(obj.pattern.frames)) throw new Error('pattern.frames が不正です')
}

function loadProject(jsonStr) {
  try {
    const obj = JSON.parse(jsonStr)
    validateProject(obj)
    Object.assign(state.project, obj)
    state.errorMessage = null
  } catch (e) {
    state.errorMessage = `読み込みエラー：${e.message}`
  }
}

function saveProject() {
  const json = JSON.stringify(state.project, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${state.project.name}.ledproj`
  a.click()
  URL.revokeObjectURL(url)
}

// バイナリエクスポート（spec §7.2 フォーマット準拠）
// パターンデータ書き込み先アドレス：0x200000（ESP32 4MB flash）
const LED_DATA_FLASH_ADDR = 0x200000

function exportBinary() {
  const { fps, loop, frames } = state.project.pattern
  const ledCount = state.project.layout.led_count
  const frameCount = frames.length
  const HEADER_SIZE = 16
  const frameSize = ledCount * 3
  const totalSize = HEADER_SIZE + frameSize * frameCount

  const buffer = new ArrayBuffer(totalSize)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  // ヘッダ
  view.setUint16(0x00, 0x4C45, true)            // マジック "LE"
  view.setUint8(0x02, 0x01)                      // バージョン
  view.setUint8(0x03, loop ? 0x01 : 0x00)        // フラグ（bit0: ループ）
  view.setUint16(0x04, ledCount, true)            // LED数
  view.setUint16(0x06, frameCount, true)          // フレーム数
  view.setUint8(0x08, fps)                        // FPS
  // 0x09〜0x0F: 予約（0x00埋め、ArrayBuffer初期値のまま）

  // フレームデータ（GRB順）
  for (let f = 0; f < frameCount; f++) {
    const frame = frames[f]
    for (let l = 0; l < ledCount; l++) {
      const led = frame.leds[l]
      const offset = HEADER_SIZE + f * frameSize + l * 3
      bytes[offset + 0] = led.g  // G
      bytes[offset + 1] = led.r  // R
      bytes[offset + 2] = led.b  // B
    }
  }

  const blob = new Blob([buffer], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${state.project.name}.led`
  a.click()
  URL.revokeObjectURL(url)
}

function clearError() {
  state.errorMessage = null
}

function newProject() {
  Object.assign(state.project, createNewProject())
  state.errorMessage = null
}

export function useProject() {
  return {
    project: readonly(state.project),
    errorMessage: computed(() => state.errorMessage),
    setLedColor,
    fillRange,
    addFrame,
    insertFrame,
    deleteFrame,
    copyFrame,
    pasteFrame,
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
  }
}
