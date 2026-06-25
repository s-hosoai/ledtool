import { reactive, readonly, computed } from 'vue'

const DEFAULT_LED_COUNT = 10
const DEFAULT_FRAME_COUNT = 10
const DEFAULT_FPS = 10

function createFrames(ledCount, frameCount) {
  return Array.from({ length: frameCount }, (_, frameIdx) => ({
    frame: frameIdx,
    leds: Array.from({ length: ledCount }, (_, id) => ({ id, r: 0, g: 0, b: 0 })),
  }))
}

function emptyFrameLeds(ledCount) {
  return Array.from({ length: ledCount }, (_, id) => ({ id, r: 0, g: 0, b: 0 }))
}

function createNewProject() {
  return {
    version: 1,
    name: '新規プロジェクト',
    layout: {
      led_count: DEFAULT_LED_COUNT,
      leds: Array.from({ length: DEFAULT_LED_COUNT }, (_, id) => ({
        id, x: 50 + id * 40, y: 100,
      })),
    },
    pattern: {
      fps: DEFAULT_FPS,
      loop: true,
      frame_count: DEFAULT_FRAME_COUNT,
      edit_mode: 'frames',        // 'frames' | 'keyframes'
      keyframes: [],              // キーフレームモード用
      gamma_correction: { enabled: false, value: 2.2 },
      frames: createFrames(DEFAULT_LED_COUNT, DEFAULT_FRAME_COUNT),
    },
  }
}

const state = reactive({
  project: createNewProject(),
  errorMessage: null,
})

// ---- キーフレーム補間 ----

function computeInterpolatedFrame(frameIdx) {
  const kfs = state.project.pattern.keyframes
  const ledCount = state.project.layout.led_count
  if (kfs.length === 0) return { frame: frameIdx, leds: emptyFrameLeds(ledCount) }

  const sorted = [...kfs].sort((a, b) => a.frame - b.frame)

  // 前後のキーフレームを探す
  let prevKF = sorted[0]
  let nextKF = null
  for (const kf of sorted) {
    if (kf.frame <= frameIdx) prevKF = kf
    if (kf.frame > frameIdx && !nextKF) nextKF = kf
  }

  // 完全一致
  if (prevKF.frame === frameIdx) return prevKF

  // 最後のキーフレームより後ろ：最後の値を保持
  if (!nextKF) return { frame: frameIdx, leds: prevKF.leds.map(l => ({ ...l })) }

  // ステップ補間：前のキーフレームの値を保持
  if (prevKF.interpolation === 'step') {
    return { frame: frameIdx, leds: prevKF.leds.map(l => ({ ...l })) }
  }

  // 線形補間
  const t = (frameIdx - prevKF.frame) / (nextKF.frame - prevKF.frame)
  const leds = prevKF.leds.map((led, i) => {
    const nled = nextKF.leds[i] ?? { r: 0, g: 0, b: 0 }
    return {
      id: led.id,
      r: Math.round(led.r + t * (nled.r - led.r)),
      g: Math.round(led.g + t * (nled.g - led.g)),
      b: Math.round(led.b + t * (nled.b - led.b)),
    }
  })
  return { frame: frameIdx, leds }
}

function getDisplayFrame(frameIdx) {
  if (state.project.pattern.edit_mode === 'keyframes') {
    return computeInterpolatedFrame(frameIdx)
  }
  return state.project.pattern.frames[frameIdx]
}

function isKeyframe(frameIdx) {
  return state.project.pattern.keyframes.some(k => k.frame === frameIdx)
}

function addKeyframe(frameIdx) {
  if (isKeyframe(frameIdx)) return
  const computed = computeInterpolatedFrame(frameIdx)
  state.project.pattern.keyframes.push({
    frame: frameIdx,
    leds: computed.leds.map(l => ({ ...l })),
    interpolation: 'linear',
  })
  state.project.pattern.keyframes.sort((a, b) => a.frame - b.frame)
}

function removeKeyframe(frameIdx) {
  const kfs = state.project.pattern.keyframes
  if (kfs.length <= 1) return
  const idx = kfs.findIndex(k => k.frame === frameIdx)
  if (idx !== -1) kfs.splice(idx, 1)
}

function setKeyframeInterpolation(frameIdx, type) {
  const kf = state.project.pattern.keyframes.find(k => k.frame === frameIdx)
  if (kf) kf.interpolation = type
}

function setEditMode(mode) {
  const current = state.project.pattern.edit_mode
  if (current === mode) return

  if (mode === 'keyframes') {
    // 全フレームをキーフレームとして登録
    state.project.pattern.keyframes = state.project.pattern.frames.map(f => ({
      frame: f.frame,
      leds: f.leds.map(l => ({ ...l })),
      interpolation: 'linear',
    }))
  } else {
    // キーフレームから全フレームを再計算
    const fc = state.project.pattern.frame_count
    state.project.pattern.frames = Array.from({ length: fc }, (_, i) => {
      const d = computeInterpolatedFrame(i)
      return { frame: i, leds: d.leds.map(l => ({ ...l })) }
    })
  }
  state.project.pattern.edit_mode = mode
}

// ---- LED 色設定（モード対応） ----

function setLedColor(frameIdx, ledId, r, g, b) {
  if (state.project.pattern.edit_mode === 'keyframes') {
    if (!isKeyframe(frameIdx)) addKeyframe(frameIdx)
    const kf = state.project.pattern.keyframes.find(k => k.frame === frameIdx)
    const led = kf?.leds[ledId]
    if (!led) return
    led.r = r; led.g = g; led.b = b
  } else {
    const led = state.project.pattern.frames[frameIdx]?.leds[ledId]
    if (!led) return
    led.r = r; led.g = g; led.b = b
  }
}

function fillRange(frameStart, frameEnd, ledStart, ledEnd, r, g, b) {
  if (state.project.pattern.edit_mode === 'keyframes') {
    // 範囲の始端・終端にキーフレームを作成し、選択LEDに色を設定
    const targets = frameStart === frameEnd
      ? [frameStart]
      : [frameStart, frameEnd]
    for (const f of targets) {
      if (!isKeyframe(f)) addKeyframe(f)
      const kf = state.project.pattern.keyframes.find(k => k.frame === f)
      if (!kf) continue
      for (let l = ledStart; l <= ledEnd; l++) {
        if (kf.leds[l]) { kf.leds[l].r = r; kf.leds[l].g = g; kf.leds[l].b = b }
      }
    }
  } else {
    for (let f = frameStart; f <= frameEnd; f++) {
      for (let l = ledStart; l <= ledEnd; l++) {
        setLedColor(f, l, r, g, b)
      }
    }
  }
}

// ---- フレーム操作 ----

function insertFrame(afterIdx, sourceFrameIdx) {
  if (state.project.pattern.edit_mode === 'keyframes') {
    // キーフレームインデックスを afterIdx+1 以降はすべて +1
    state.project.pattern.keyframes.forEach(kf => {
      if (kf.frame > afterIdx) kf.frame += 1
    })
    // sourceFrameIdx のキーフレームをコピーして挿入
    const src = computeInterpolatedFrame(sourceFrameIdx)
    state.project.pattern.keyframes.push({
      frame: afterIdx + 1,
      leds: src.leds.map(l => ({ ...l })),
      interpolation: 'linear',
    })
    state.project.pattern.keyframes.sort((a, b) => a.frame - b.frame)
    state.project.pattern.frame_count += 1
  } else {
    const src = state.project.pattern.frames[sourceFrameIdx]
    const newFrame = {
      frame: afterIdx + 1,
      leds: src.leds.map(l => ({ ...l })),
    }
    state.project.pattern.frames.splice(afterIdx + 1, 0, newFrame)
    state.project.pattern.frames.forEach((f, i) => { f.frame = i })
    state.project.pattern.frame_count = state.project.pattern.frames.length
  }
}

function addFrame() {
  const ledCount = state.project.layout.led_count
  if (state.project.pattern.edit_mode === 'keyframes') {
    state.project.pattern.frame_count += 1
  } else {
    const newIdx = state.project.pattern.frames.length
    state.project.pattern.frames.push({
      frame: newIdx,
      leds: Array.from({ length: ledCount }, (_, id) => ({ id, r: 0, g: 0, b: 0 })),
    })
    state.project.pattern.frame_count = state.project.pattern.frames.length
  }
}

function deleteFrame(frameIdx) {
  if (state.project.pattern.edit_mode === 'keyframes') {
    if (state.project.pattern.frame_count <= 1) return
    // 対象がキーフレームなら削除
    const ki = state.project.pattern.keyframes.findIndex(k => k.frame === frameIdx)
    if (ki !== -1) state.project.pattern.keyframes.splice(ki, 1)
    // frameIdx より後ろのキーフレームインデックスを -1
    state.project.pattern.keyframes.forEach(kf => {
      if (kf.frame > frameIdx) kf.frame -= 1
    })
    state.project.pattern.frame_count -= 1
  } else {
    if (state.project.pattern.frames.length <= 1) return
    state.project.pattern.frames.splice(frameIdx, 1)
    state.project.pattern.frames.forEach((f, i) => { f.frame = i })
    state.project.pattern.frame_count = state.project.pattern.frames.length
  }
}

let copiedFrame = null
function copyFrame(frameIdx) {
  const frame = getDisplayFrame(frameIdx)
  if (!frame) return
  copiedFrame = frame.leds.map(l => ({ ...l }))
}

function pasteFrame(frameIdx) {
  if (!copiedFrame) return
  if (state.project.pattern.edit_mode === 'keyframes') {
    if (!isKeyframe(frameIdx)) addKeyframe(frameIdx)
    const kf = state.project.pattern.keyframes.find(k => k.frame === frameIdx)
    if (kf) kf.leds = copiedFrame.map(l => ({ ...l }))
  } else {
    const frame = state.project.pattern.frames[frameIdx]
    if (frame) frame.leds = copiedFrame.map(l => ({ ...l }))
  }
}

// ---- LED 数・設定変更 ----

function setLedCount(newCount) {
  if (newCount < 1 || newCount > 256) return
  const oldCount = state.project.layout.led_count
  state.project.layout.led_count = newCount

  if (newCount > oldCount) {
    for (let id = oldCount; id < newCount; id++) {
      state.project.layout.leds.push({ id, x: 50 + id * 40, y: 100 })
    }
  } else {
    state.project.layout.leds = state.project.layout.leds.slice(0, newCount)
  }

  const resize = (leds) => {
    if (newCount > oldCount) {
      for (let id = oldCount; id < newCount; id++) leds.push({ id, r: 0, g: 0, b: 0 })
    } else {
      leds.splice(newCount)
    }
  }

  state.project.pattern.frames.forEach(f => resize(f.leds))
  state.project.pattern.keyframes.forEach(kf => resize(kf.leds))
}

function setLedPosition(id, x, y) {
  const led = state.project.layout.leds.find(l => l.id === id)
  if (!led) return
  led.x = Math.round(x); led.y = Math.round(y)
}

const PRESET_SPACING = 40

function applyLayoutPreset(type, opts = {}) {
  const leds = state.project.layout.leds
  const n = leds.length
  if (n === 0) return
  const sp = opts.spacing ?? PRESET_SPACING

  if (type === 'linear') {
    leds.forEach((l, i) => { l.x = 50 + i * sp; l.y = 150 })
  } else if (type === 'serpentine') {
    const cols = opts.cols ?? Math.max(2, Math.ceil(Math.sqrt(n)))
    leds.forEach((l, i) => {
      const row = Math.floor(i / cols); const pos = i % cols
      l.x = 50 + (row % 2 === 0 ? pos : cols - 1 - pos) * sp
      l.y = 50 + row * sp
    })
  } else if (type === 'grid') {
    const cols = opts.cols ?? Math.ceil(Math.sqrt(n))
    leds.forEach((l, i) => {
      l.x = 50 + (i % cols) * sp; l.y = 50 + Math.floor(i / cols) * sp
    })
  } else if (type === 'circle') {
    const r = Math.max(60, n * sp / (2 * Math.PI))
    const cx = r + 60; const cy = r + 60
    leds.forEach((l, i) => {
      const a = (2 * Math.PI * i / n) - Math.PI / 2
      l.x = Math.round(cx + r * Math.cos(a)); l.y = Math.round(cy + r * Math.sin(a))
    })
  }
}

function setFps(fps) {
  state.project.pattern.fps = Math.max(1, Math.min(60, fps))
}

function setLoop(loop) { state.project.pattern.loop = loop }
function setProjectName(name) { state.project.name = name }

// ---- ガンマ補正 ----

function setGamma(enabled, value) {
  state.project.pattern.gamma_correction.enabled = enabled
  if (value !== undefined) state.project.pattern.gamma_correction.value = value
}

function applyGamma(v, gamma) {
  return Math.round(Math.pow(Math.max(0, Math.min(255, v)) / 255, gamma) * 255)
}

// ---- パターン変換 ----

function reverseFrames() {
  if (state.project.pattern.edit_mode === 'keyframes') {
    const maxF = state.project.pattern.frame_count - 1
    state.project.pattern.keyframes.forEach(kf => { kf.frame = maxF - kf.frame })
    state.project.pattern.keyframes.sort((a, b) => a.frame - b.frame)
  } else {
    const frames = state.project.pattern.frames
    frames.reverse()
    frames.forEach((f, i) => { f.frame = i })
  }
}

function mirrorLeds() {
  const op = (leds) => {
    const rev = [...leds].reverse()
    rev.forEach((l, i) => { l.id = i })
    return rev
  }
  if (state.project.pattern.edit_mode === 'keyframes') {
    state.project.pattern.keyframes.forEach(kf => { kf.leds = op(kf.leds) })
  } else {
    state.project.pattern.frames.forEach(f => { f.leds = op(f.leds) })
  }
}

function invertColors() {
  const op = (leds) => leds.forEach(l => { l.r = 255 - l.r; l.g = 255 - l.g; l.b = 255 - l.b })
  if (state.project.pattern.edit_mode === 'keyframes') {
    state.project.pattern.keyframes.forEach(kf => op(kf.leds))
  } else {
    state.project.pattern.frames.forEach(f => op(f.leds))
  }
}

// ---- 保存・読み込み ----

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
    // 旧バージョンのフィールドを補完
    if (!obj.pattern.edit_mode) obj.pattern.edit_mode = 'frames'
    if (!obj.pattern.keyframes) obj.pattern.keyframes = []
    if (!obj.pattern.gamma_correction) obj.pattern.gamma_correction = { enabled: false, value: 2.2 }
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
  a.href = url; a.download = `${state.project.name}.ledproj`; a.click()
  URL.revokeObjectURL(url)
}

const LED_DATA_FLASH_ADDR = 0x200000

function exportBinary() {
  const { fps, loop, frame_count, gamma_correction } = state.project.pattern
  const ledCount = state.project.layout.led_count
  const frameCount = frame_count
  const gamma = gamma_correction?.enabled ? (gamma_correction?.value ?? 2.2) : null
  const HEADER_SIZE = 16
  const frameSize = ledCount * 3
  const totalSize = HEADER_SIZE + frameSize * frameCount

  const buffer = new ArrayBuffer(totalSize)
  const view = new DataView(buffer); const bytes = new Uint8Array(buffer)

  view.setUint16(0x00, 0x4C45, true)
  view.setUint8(0x02, 0x01)
  view.setUint8(0x03, loop ? 0x01 : 0x00)
  view.setUint16(0x04, ledCount, true)
  view.setUint16(0x06, frameCount, true)
  view.setUint8(0x08, fps)

  for (let f = 0; f < frameCount; f++) {
    const frame = getDisplayFrame(f)
    for (let l = 0; l < ledCount; l++) {
      const led = frame?.leds[l] ?? { r: 0, g: 0, b: 0 }
      let r = led.r, g = led.g, b = led.b
      if (gamma) { r = applyGamma(r, gamma); g = applyGamma(g, gamma); b = applyGamma(b, gamma) }
      const offset = HEADER_SIZE + f * frameSize + l * 3
      bytes[offset + 0] = g; bytes[offset + 1] = r; bytes[offset + 2] = b
    }
  }

  const blob = new Blob([buffer], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `${state.project.name}.led`; a.click()
  URL.revokeObjectURL(url)
}

function clearError() { state.errorMessage = null }

function newProject() {
  Object.assign(state.project, createNewProject())
  state.errorMessage = null
}

export function useProject() {
  return {
    project: readonly(state.project),
    errorMessage: computed(() => state.errorMessage),
    // 色設定
    setLedColor,
    fillRange,
    // フレーム操作
    addFrame,
    insertFrame,
    deleteFrame,
    copyFrame,
    pasteFrame,
    // LED/FPS/設定
    setLedCount,
    setFps,
    setLoop,
    setProjectName,
    // レイアウト
    setLedPosition,
    applyLayoutPreset,
    // キーフレーム
    setEditMode,
    addKeyframe,
    removeKeyframe,
    isKeyframe,
    setKeyframeInterpolation,
    getDisplayFrame,
    computeInterpolatedFrame,
    // ガンマ
    setGamma,
    // 変換
    reverseFrames,
    mirrorLeds,
    invertColors,
    // 保存・エクスポート
    loadProject,
    saveProject,
    exportBinary,
    newProject,
    clearError,
    LED_DATA_FLASH_ADDR,
  }
}
