import { reactive, readonly, computed } from 'vue'

const DEFAULT_LED_COUNT = 10
const DEFAULT_FRAME_COUNT = 10
const DEFAULT_FPS = 10

function createFrames(ledCount, frameCount) {
  return Array.from({ length: frameCount }, (_, fi) => ({
    frame: fi,
    leds: Array.from({ length: ledCount }, (_, id) => ({ id, r: 0, g: 0, b: 0 })),
  }))
}

function createNewProject() {
  return {
    version: 1,
    name: '新規プロジェクト',
    layout: {
      led_count: DEFAULT_LED_COUNT,
      led_shape: 'circle',  // 'circle' | 'square'
      leds: Array.from({ length: DEFAULT_LED_COUNT }, (_, id) => ({
        id, x: 50 + id * 40, y: 100,
      })),
    },
    pattern: {
      fps: DEFAULT_FPS,
      loop: true,
      frame_count: DEFAULT_FRAME_COUNT,
      edit_mode: 'frames',       // 'frames' | 'keyframes'
      // Per-cell keyframes: { led, frame, r, g, b, interp:'linear'|'step' }
      kf_cells: [],
      gamma_correction: { enabled: false, value: 2.2 },
      frames: createFrames(DEFAULT_LED_COUNT, DEFAULT_FRAME_COUNT),
    },
  }
}

const state = reactive({
  project: createNewProject(),
  errorMessage: null,
  hasCopied: false,
})

// ---- Per-cell キーフレーム補間 ----

function _interpolateLed(ledId, frameIdx, sortedCells) {
  if (sortedCells.length === 0) return { id: ledId, r: 0, g: 0, b: 0 }
  let prev = sortedCells[0]; let next = null
  for (const c of sortedCells) {
    if (c.frame <= frameIdx) prev = c
    if (c.frame > frameIdx && !next) next = c
  }
  if (prev.frame === frameIdx) return { id: ledId, r: prev.r, g: prev.g, b: prev.b }
  if (!next) return { id: ledId, r: prev.r, g: prev.g, b: prev.b }
  if (prev.interp === 'step') return { id: ledId, r: prev.r, g: prev.g, b: prev.b }
  const t = (frameIdx - prev.frame) / (next.frame - prev.frame)
  return {
    id: ledId,
    r: Math.round(prev.r + t * (next.r - prev.r)),
    g: Math.round(prev.g + t * (next.g - prev.g)),
    b: Math.round(prev.b + t * (next.b - prev.b)),
  }
}

function computeInterpolatedFrame(frameIdx) {
  const lc = state.project.layout.led_count
  const byLed = new Map()
  for (const c of state.project.pattern.kf_cells) {
    if (!byLed.has(c.led)) byLed.set(c.led, [])
    byLed.get(c.led).push(c)
  }
  for (const [, arr] of byLed) arr.sort((a, b) => a.frame - b.frame)
  return {
    frame: frameIdx,
    leds: Array.from({ length: lc }, (_, i) =>
      _interpolateLed(i, frameIdx, byLed.get(i) ?? [])
    ),
  }
}

function getDisplayFrame(frameIdx) {
  if (state.project.pattern.edit_mode === 'keyframes') {
    return computeInterpolatedFrame(frameIdx)
  }
  return state.project.pattern.frames[frameIdx]
}

// ---- Per-cell KF 操作 ----

function isKfCell(led, frame) {
  return state.project.pattern.kf_cells.some(c => c.led === led && c.frame === frame)
}

function setKfCell(led, frame, r, g, b, interp) {
  const ex = state.project.pattern.kf_cells.find(c => c.led === led && c.frame === frame)
  if (ex) {
    ex.r = r; ex.g = g; ex.b = b
    if (interp !== undefined) ex.interp = interp
  } else {
    state.project.pattern.kf_cells.push({ led, frame, r, g, b, interp: interp ?? 'linear' })
  }
}

function removeKfCells(ledStart, ledEnd, frameStart, frameEnd) {
  state.project.pattern.kf_cells = state.project.pattern.kf_cells.filter(
    c => !(c.led >= ledStart && c.led <= ledEnd && c.frame >= frameStart && c.frame <= frameEnd)
  )
}

function setKfCellInterpRange(ledStart, ledEnd, frameStart, frameEnd, interp) {
  state.project.pattern.kf_cells.forEach(c => {
    if (c.led >= ledStart && c.led <= ledEnd && c.frame >= frameStart && c.frame <= frameEnd) {
      c.interp = interp
    }
  })
}

function getKfCellInterp(led, frame) {
  const c = state.project.pattern.kf_cells.find(c => c.led === led && c.frame === frame)
  return c?.interp ?? 'linear'
}

// ---- 編集モード切替 ----

function setEditMode(mode) {
  const cur = state.project.pattern.edit_mode
  if (cur === mode) return

  if (mode === 'keyframes') {
    const lc = state.project.layout.led_count
    const fc = state.project.pattern.frame_count
    const cells = []
    // フレーム0 と最終フレームの色だけをKFとして設定（中間は補間）
    const lastF = fc - 1
    for (let led = 0; led < lc; led++) {
      const f0 = state.project.pattern.frames[0]?.leds[led] ?? { r: 0, g: 0, b: 0 }
      cells.push({ led, frame: 0, r: f0.r, g: f0.g, b: f0.b, interp: 'linear' })
      if (lastF > 0) {
        const fl = state.project.pattern.frames[lastF]?.leds[led] ?? { r: 0, g: 0, b: 0 }
        cells.push({ led, frame: lastF, r: fl.r, g: fl.g, b: fl.b, interp: 'linear' })
      }
    }
    state.project.pattern.kf_cells = cells
  } else {
    // キーフレームから全フレームを再計算して frames[] に書き戻す
    const fc = state.project.pattern.frame_count
    state.project.pattern.frames = Array.from({ length: fc }, (_, i) => {
      const d = computeInterpolatedFrame(i)
      return { frame: i, leds: d.leds.map(l => ({ ...l })) }
    })
    state.project.pattern.kf_cells = []
  }
  state.project.pattern.edit_mode = mode
}

// ---- LED 色設定（モード対応） ----

function setLedColor(frameIdx, ledId, r, g, b) {
  if (state.project.pattern.edit_mode === 'keyframes') {
    setKfCell(ledId, frameIdx, r, g, b)
  } else {
    const led = state.project.pattern.frames[frameIdx]?.leds[ledId]
    if (!led) return
    led.r = r; led.g = g; led.b = b
  }
}

function fillRange(frameStart, frameEnd, ledStart, ledEnd, r, g, b) {
  if (state.project.pattern.edit_mode === 'keyframes') {
    // 選択範囲の全セルをKFとして設定
    for (let f = frameStart; f <= frameEnd; f++) {
      for (let l = ledStart; l <= ledEnd; l++) {
        setKfCell(l, f, r, g, b)
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
    // afterIdx より後ろのKFインデックスを +1
    state.project.pattern.kf_cells.forEach(c => { if (c.frame > afterIdx) c.frame += 1 })
    // sourceFrameIdx の計算済みフレームを KF として挿入
    const src = computeInterpolatedFrame(sourceFrameIdx)
    src.leds.forEach(led => {
      state.project.pattern.kf_cells.push({
        led: led.id, frame: afterIdx + 1,
        r: led.r, g: led.g, b: led.b, interp: 'linear',
      })
    })
    state.project.pattern.frame_count += 1
  } else {
    const src = state.project.pattern.frames[sourceFrameIdx]
    const newFrame = { frame: afterIdx + 1, leds: src.leds.map(l => ({ ...l })) }
    state.project.pattern.frames.splice(afterIdx + 1, 0, newFrame)
    state.project.pattern.frames.forEach((f, i) => { f.frame = i })
    state.project.pattern.frame_count = state.project.pattern.frames.length
  }
}

function addFrame() {
  const lc = state.project.layout.led_count
  if (state.project.pattern.edit_mode === 'keyframes') {
    state.project.pattern.frame_count += 1
  } else {
    const ni = state.project.pattern.frames.length
    state.project.pattern.frames.push({
      frame: ni,
      leds: Array.from({ length: lc }, (_, id) => ({ id, r: 0, g: 0, b: 0 })),
    })
    state.project.pattern.frame_count = state.project.pattern.frames.length
  }
}

function deleteFrame(frameIdx) {
  if (state.project.pattern.edit_mode === 'keyframes') {
    if (state.project.pattern.frame_count <= 1) return
    removeKfCells(0, state.project.layout.led_count - 1, frameIdx, frameIdx)
    state.project.pattern.kf_cells.forEach(c => { if (c.frame > frameIdx) c.frame -= 1 })
    state.project.pattern.frame_count -= 1
  } else {
    if (state.project.pattern.frames.length <= 1) return
    state.project.pattern.frames.splice(frameIdx, 1)
    state.project.pattern.frames.forEach((f, i) => { f.frame = i })
    state.project.pattern.frame_count = state.project.pattern.frames.length
  }
}

// コピー・ペースト（矩形ブロック）
let _copiedBlock = null

function copyRange(frameStart, frameEnd, ledStart, ledEnd) {
  const rows = []
  for (let f = frameStart; f <= frameEnd; f++) {
    const row = []
    for (let l = ledStart; l <= ledEnd; l++) {
      const frame = getDisplayFrame(f)
      const led = frame?.leds[l] ?? { r: 0, g: 0, b: 0 }
      row.push({ r: led.r, g: led.g, b: led.b })
    }
    rows.push(row)
  }
  _copiedBlock = {
    frameCount: frameEnd - frameStart + 1,
    ledCount: ledEnd - ledStart + 1,
    rows,
  }
  state.hasCopied = true
}

function pasteAt(frameStart, ledStart) {
  if (!_copiedBlock) return
  const maxFrame = state.project.pattern.frame_count
  const maxLed = state.project.layout.led_count
  for (let rf = 0; rf < _copiedBlock.frameCount; rf++) {
    const f = frameStart + rf
    if (f >= maxFrame) continue
    for (let rl = 0; rl < _copiedBlock.ledCount; rl++) {
      const l = ledStart + rl
      if (l >= maxLed) continue
      const c = _copiedBlock.rows[rf][rl]
      setLedColor(f, l, c.r, c.g, c.b)
    }
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
    state.project.pattern.kf_cells = state.project.pattern.kf_cells.filter(c => c.led < newCount)
  }

  state.project.pattern.frames.forEach(f => {
    if (newCount > oldCount) {
      for (let id = oldCount; id < newCount; id++) f.leds.push({ id, r: 0, g: 0, b: 0 })
    } else {
      f.leds = f.leds.slice(0, newCount)
    }
  })
}

function setLedShape(shape) {
  state.project.layout.led_shape = shape
}

function setLedPosition(id, x, y) {
  const led = state.project.layout.leds.find(l => l.id === id)
  if (!led) return
  led.x = Math.round(x); led.y = Math.round(y)
}

const PRESET_SPACING = 40
function applyLayoutPreset(type, opts = {}) {
  const leds = state.project.layout.leds
  const n = leds.length; if (n === 0) return
  const sp = opts.spacing ?? PRESET_SPACING
  if (type === 'linear') {
    leds.forEach((l, i) => { l.x = 50 + i * sp; l.y = 150 })
  } else if (type === 'square_frame') {
    // N個のLEDを正方形の枠（周囲）に等間隔配置
    const s = opts.size ?? Math.max(80, n * sp / 4)
    const ox = 60; const oy = 60
    leds.forEach((l, i) => {
      const t4 = (i / n) * 4
      const side = Math.floor(t4); const frac = t4 - side
      switch (side % 4) {
        case 0: l.x = Math.round(ox + frac * s);     l.y = Math.round(oy);         break // 上辺
        case 1: l.x = Math.round(ox + s);            l.y = Math.round(oy + frac * s); break // 右辺
        case 2: l.x = Math.round(ox + s - frac * s); l.y = Math.round(oy + s);     break // 下辺
        case 3: l.x = Math.round(ox);                l.y = Math.round(oy + s - frac * s); break // 左辺
      }
    })
  } else if (type === 'grid') {
    const cols = opts.cols ?? Math.ceil(Math.sqrt(n))
    leds.forEach((l, i) => { l.x = 50 + (i % cols) * sp; l.y = 50 + Math.floor(i / cols) * sp })
  } else if (type === 'circle') {
    const r = Math.max(60, n * sp / (2 * Math.PI)); const cx = r + 60; const cy = r + 60
    leds.forEach((l, i) => {
      const a = (2 * Math.PI * i / n) - Math.PI / 2
      l.x = Math.round(cx + r * Math.cos(a)); l.y = Math.round(cy + r * Math.sin(a))
    })
  }
}

function setFps(fps) { state.project.pattern.fps = Math.max(1, Math.min(60, fps)) }
function setLoop(loop) { state.project.pattern.loop = loop }
function setProjectName(name) { state.project.name = name }

// ---- ガンマ補正 ----

function setGamma(enabled, value) {
  state.project.pattern.gamma_correction.enabled = enabled
  if (value !== undefined) state.project.pattern.gamma_correction.value = value
}

function _applyGamma(v, g) {
  return Math.round(Math.pow(Math.max(0, Math.min(255, v)) / 255, g) * 255)
}

// ---- パターン変換 ----

function reverseFrames() {
  if (state.project.pattern.edit_mode === 'keyframes') {
    const mx = state.project.pattern.frame_count - 1
    state.project.pattern.kf_cells.forEach(c => { c.frame = mx - c.frame })
  } else {
    state.project.pattern.frames.reverse()
    state.project.pattern.frames.forEach((f, i) => { f.frame = i })
  }
}

function mirrorLeds() {
  const ml = state.project.layout.led_count - 1
  if (state.project.pattern.edit_mode === 'keyframes') {
    state.project.pattern.kf_cells.forEach(c => { c.led = ml - c.led })
  } else {
    const op = (leds) => { const r = [...leds].reverse(); r.forEach((l, i) => { l.id = i }); return r }
    state.project.pattern.frames.forEach(f => { f.leds = op(f.leds) })
  }
}

function invertColors() {
  const op = (c) => { c.r = 255 - c.r; c.g = 255 - c.g; c.b = 255 - c.b }
  if (state.project.pattern.edit_mode === 'keyframes') {
    state.project.pattern.kf_cells.forEach(op)
  } else {
    state.project.pattern.frames.forEach(f => f.leds.forEach(op))
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
    if (!obj.layout.led_shape) obj.layout.led_shape = 'circle'
    if (!obj.pattern.edit_mode) obj.pattern.edit_mode = 'frames'
    if (!obj.pattern.gamma_correction) obj.pattern.gamma_correction = { enabled: false, value: 2.2 }
    // 旧 per-frame keyframes フォーマットを per-cell 形式に移行
    if (!obj.pattern.kf_cells) {
      if (Array.isArray(obj.pattern.keyframes) && obj.pattern.keyframes.length > 0) {
        obj.pattern.kf_cells = []
        for (const kf of obj.pattern.keyframes) {
          kf.leds.forEach((led, i) => {
            obj.pattern.kf_cells.push({
              led: i, frame: kf.frame,
              r: led.r, g: led.g, b: led.b,
              interp: kf.interpolation ?? 'linear',
            })
          })
        }
      } else {
        obj.pattern.kf_cells = []
      }
    }
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
  const HEADER_SIZE = 16; const frameSize = ledCount * 3
  const buffer = new ArrayBuffer(HEADER_SIZE + frameSize * frameCount)
  const view = new DataView(buffer); const bytes = new Uint8Array(buffer)

  view.setUint16(0x00, 0x4C45, true); view.setUint8(0x02, 0x01)
  view.setUint8(0x03, loop ? 0x01 : 0x00)
  view.setUint16(0x04, ledCount, true); view.setUint16(0x06, frameCount, true)
  view.setUint8(0x08, fps)

  for (let f = 0; f < frameCount; f++) {
    const frame = getDisplayFrame(f)
    for (let l = 0; l < ledCount; l++) {
      const led = frame?.leds[l] ?? { r: 0, g: 0, b: 0 }
      let r = led.r, g = led.g, b = led.b
      if (gamma) { r = _applyGamma(r, gamma); g = _applyGamma(g, gamma); b = _applyGamma(b, gamma) }
      const off = HEADER_SIZE + f * frameSize + l * 3
      bytes[off] = g; bytes[off + 1] = r; bytes[off + 2] = b
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
    setLedColor,
    fillRange,
    addFrame,
    insertFrame,
    deleteFrame,
    hasCopied: computed(() => state.hasCopied),
    copyRange,
    pasteAt,
    setLedCount,
    setFps,
    setLoop,
    setProjectName,
    setLedShape,
    setLedPosition,
    applyLayoutPreset,
    // キーフレーム（per-cell）
    setEditMode,
    isKfCell,
    setKfCell,
    removeKfCells,
    setKfCellInterpRange,
    getKfCellInterp,
    getDisplayFrame,
    computeInterpolatedFrame,
    // ガンマ
    setGamma,
    // 変換
    reverseFrames,
    mirrorLeds,
    invertColors,
    loadProject,
    saveProject,
    exportBinary,
    newProject,
    clearError,
    LED_DATA_FLASH_ADDR,
  }
}
