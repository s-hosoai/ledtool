<template>
  <div class="timeline-wrapper">
    <!-- ツールバー行1：フレーム操作 -->
    <div class="timeline-toolbar">
      <button @click="addFrame">＋追加</button>
      <button @click="onCopyFrame" :disabled="selection === null">コピー</button>
      <button @click="onPasteFrame" :disabled="selection === null || !hasCopied">ペースト</button>
      <button @click="onDeleteFrame" :disabled="selectedFrame === null || frameCount <= 1">削除</button>
      <button @click="onInsertFrame" :disabled="selectedFrame === null">後ろに挿入</button>
      <div class="toolbar-sep" />
      <button
        :class="['btn-kf-mode', { active: editMode === 'keyframes' }]"
        @click="toggleEditMode"
        title="キーフレーム補間モードに切り替え"
      >キーフレーム</button>
      <template v-if="editMode === 'keyframes'">
        <button @click="onMarkAsKf" :disabled="selection === null"
          title="選択セルをキーフレームとして設定">KFにする</button>
        <button @click="onRemoveKfCells" :disabled="!selectionHasKf"
          title="選択セルのキーフレームを解除">KF解除</button>
        <select v-if="showInterpSelect"
          :value="selectedKfInterp" @change="onSetInterp($event.target.value)"
          title="補間タイプ" class="interp-select">
          <option value="linear">線形</option>
          <option value="step">ステップ</option>
        </select>
      </template>
    </div>

    <!-- ツールバー行2：変換 -->
    <div class="timeline-toolbar toolbar-row2">
      <span class="toolbar-label">変換：</span>
      <button @click="onReverseFrames">フレーム反転</button>
      <button @click="onMirrorLeds">LED反転</button>
      <button @click="onInvertColors">色反転</button>
      <span class="toolbar-hint">
        <span v-if="editMode === 'keyframes'">◆=KF　暗いセル=補間　色変更→KF自動作成</span>
        <span v-else>ドラッグ：範囲選択</span>
      </span>
    </div>

    <!-- パレット行 -->
    <div class="palette-bar">
      <span class="palette-label">パレット：</span>
      <div
        v-for="(color, i) in PALETTE"
        :key="i"
        class="palette-swatch"
        :class="{ selected: isPaletteSelected(color) }"
        :style="{ background: `rgb(${color.r},${color.g},${color.b})` }"
        @click="togglePaint(color)"
        :title="`RGB(${color.r}, ${color.g}, ${color.b})`"
      />
      <span v-if="paintColor !== null" class="paint-active-label">
        ペイント中 — クリック/ドラッグで塗る
      </span>
      <button v-if="paintColor !== null" class="paint-cancel-btn" @click="paintColor = null">解除</button>
    </div>

    <!-- キャンバス（スクロール可） -->
    <div class="canvas-scroll" ref="scrollRef">
      <canvas
        ref="canvasRef"
        @mousedown="onMouseDown"
        @mousemove="onMouseMove"
        @mouseup="onMouseUp"
        @mouseleave="onMouseLeave"
        :style="{ display: 'block', cursor: canvasCursor }"
      />
    </div>

    <!-- カラーピッカーバー（下部固定） -->
    <div class="color-bar">
      <span class="color-bar-label">{{ selectionLabel }}</span>
      <ColorPicker
        :modelValue="pickerRgb"
        :disabled="selection === null && paintColor === null"
        @update:modelValue="onColorChange"
      />
      <button v-if="selection !== null" class="clear-btn" @click="clearSelection">✕ 選択解除</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useProject } from '../composables/useProject.js'
import ColorPicker from './ColorPicker.vue'

const {
  project,
  setEditMode,
  isKfCell,
  setKfCell,
  removeKfCells,
  setKfCellInterpRange,
  getKfCellInterp,
  getDisplayFrame,
  fillRange,
  addFrame,
  insertFrame,
  deleteFrame,
  hasCopied,
  copyRange,
  pasteAt,
  reverseFrames,
  mirrorLeds,
  invertColors,
} = useProject()

const CELL_W = 32
const CELL_H = 28
const HEADER_H = 24
const LABEL_W = 36

// パレット定義
const PALETTE = [
  { r:   0, g:   0, b:   0 },
  { r: 255, g: 255, b: 255 },
  { r: 255, g:   0, b:   0 },
  { r:   0, g: 200, b:   0 },
  { r:   0, g:   0, b: 255 },
  { r: 255, g: 255, b:   0 },
  { r:   0, g: 220, b: 220 },
  { r: 220, g:   0, b: 220 },
  { r: 255, g: 128, b:   0 },
  { r: 160, g:   0, b: 255 },
  { r:   0, g: 128, b: 255 },
  { r: 255, g:  64, b: 128 },
  { r:   0, g: 100, b:   0 },
  { r: 120, g:  60, b:   0 },
  { r: 255, g: 200, b: 100 },
  { r: 128, g: 128, b: 128 },
]

const canvasRef = ref(null)
const scrollRef = ref(null)

const dragStart = ref(null)
const dragEnd = ref(null)
const isDragging = ref(false)
const selection = ref(null)
const selectedFrame = ref(null)
const pickerRgb = ref({ r: 0, g: 0, b: 0 })

// ペイントモード
const paintColor = ref(null)
const isPaintDragging = ref(false)

const canvasCursor = computed(() => paintColor.value !== null ? 'cell' : 'crosshair')

function isPaletteSelected(color) {
  if (!paintColor.value) return false
  return paintColor.value.r === color.r && paintColor.value.g === color.g && paintColor.value.b === color.b
}

function togglePaint(color) {
  if (isPaletteSelected(color)) {
    paintColor.value = null
  } else {
    paintColor.value = { ...color }
    pickerRgb.value = { ...color }
  }
}

const frameCount = computed(() => project.pattern.frame_count)
const ledCount = computed(() => project.layout.led_count)
const editMode = computed(() => project.pattern.edit_mode)

const selectionHasKf = computed(() => {
  if (!selection.value || editMode.value !== 'keyframes') return false
  const { frameStart, frameEnd, ledStart, ledEnd } = selection.value
  return project.pattern.kf_cells.some(
    c => c.led >= ledStart && c.led <= ledEnd && c.frame >= frameStart && c.frame <= frameEnd
  )
})

const showInterpSelect = computed(() =>
  editMode.value === 'keyframes' && selection.value !== null &&
  isKfCell(selection.value.ledStart, selection.value.frameStart)
)

const selectedKfInterp = computed(() => {
  if (!selection.value || editMode.value !== 'keyframes') return 'linear'
  return getKfCellInterp(selection.value.ledStart, selection.value.frameStart)
})

const selectionLabel = computed(() => {
  const sel = selection.value
  if (!sel) {
    if (paintColor.value) return `ペイント色：RGB(${paintColor.value.r}, ${paintColor.value.g}, ${paintColor.value.b})`
    return 'セルをクリック / ドラッグで色を設定'
  }
  if (sel.frameStart === sel.frameEnd && sel.ledStart === sel.ledEnd) {
    const kfInfo = (editMode.value === 'keyframes')
      ? (isKfCell(sel.ledStart, sel.frameStart) ? ' ◆KF' : ' 補間')
      : ''
    return `フレーム ${sel.frameStart}  /  LED ${sel.ledStart}${kfInfo}`
  }
  return `フレーム ${sel.frameStart}〜${sel.frameEnd}  /  LED ${sel.ledStart}〜${sel.ledEnd}`
})

const canvasWidth = computed(() => LABEL_W + frameCount.value * CELL_W)
const canvasHeight = computed(() => HEADER_H + ledCount.value * CELL_H)

function cellAt(x, y) {
  const f = Math.floor((x - LABEL_W) / CELL_W)
  const l = Math.floor((y - HEADER_H) / CELL_H)
  if (f < 0 || f >= frameCount.value || l < 0 || l >= ledCount.value) return null
  return { frame: f, led: l }
}

// ---- 描画 ----
function draw() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  const isKfMode = editMode.value === 'keyframes'
  let cellKfSet = null; let framesWithKf = null
  if (isKfMode) {
    cellKfSet = new Set(project.pattern.kf_cells.map(c => `${c.led}:${c.frame}`))
    framesWithKf = new Set(project.pattern.kf_cells.map(c => c.frame))
  }

  ctx.fillStyle = '#2a2a2a'
  ctx.fillRect(LABEL_W, 0, canvas.width - LABEL_W, HEADER_H)
  ctx.font = '10px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  for (let f = 0; f < frameCount.value; f++) {
    const x = LABEL_W + f * CELL_W; const cx = x + CELL_W / 2
    if (isKfMode && framesWithKf.has(f)) {
      ctx.fillStyle = '#3a2800'; ctx.fillRect(x, 0, CELL_W, HEADER_H)
    }
    ctx.fillStyle = (isKfMode && framesWithKf.has(f)) ? '#f0a020' : '#aaa'
    ctx.fillText(String(f), cx, HEADER_H / 2)
  }
  if (isKfMode) {
    ctx.fillStyle = '#c07010'
    for (const f of framesWithKf) {
      const cx = LABEL_W + f * CELL_W + CELL_W / 2; const cy = HEADER_H - 3
      ctx.beginPath()
      ctx.moveTo(cx, cy - 3); ctx.lineTo(cx + 3, cy); ctx.lineTo(cx, cy + 3); ctx.lineTo(cx - 3, cy)
      ctx.closePath(); ctx.fill()
    }
  }

  ctx.fillStyle = '#2a2a2a'; ctx.fillRect(0, HEADER_H, LABEL_W, canvas.height - HEADER_H)
  ctx.fillStyle = '#aaa'; ctx.font = '10px monospace'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
  for (let l = 0; l < ledCount.value; l++) {
    ctx.fillText(String(l), LABEL_W - 4, HEADER_H + l * CELL_H + CELL_H / 2)
  }

  for (let f = 0; f < frameCount.value; f++) {
    const frame = getDisplayFrame(f)
    for (let l = 0; l < ledCount.value; l++) {
      const led = frame?.leds[l]
      if (!led) continue
      const x = LABEL_W + f * CELL_W; const y = HEADER_H + l * CELL_H
      const isBlack = led.r === 0 && led.g === 0 && led.b === 0
      ctx.fillStyle = isBlack ? '#1a1a1a' : `rgb(${led.r},${led.g},${led.b})`
      ctx.fillRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2)

      if (isKfMode) {
        const kfKey = `${l}:${f}`
        if (cellKfSet.has(kfKey)) {
          ctx.fillStyle = '#f0a020'
          const mx = x + CELL_W - 5; const my = y + 5
          ctx.beginPath()
          ctx.moveTo(mx, my - 4); ctx.lineTo(mx + 3, my); ctx.lineTo(mx, my + 4); ctx.lineTo(mx - 3, my)
          ctx.closePath(); ctx.fill()
        } else {
          ctx.fillStyle = 'rgba(0,0,0,0.38)'
          ctx.fillRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2)
        }
      }
    }
  }

  const sel = isDragging.value ? getDragSelection() : selection.value
  if (sel) {
    const x = LABEL_W + sel.frameStart * CELL_W; const y = HEADER_H + sel.ledStart * CELL_H
    const w = (sel.frameEnd - sel.frameStart + 1) * CELL_W; const h = (sel.ledEnd - sel.ledStart + 1) * CELL_H
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2)
  }
}

function getDragSelection() {
  if (!dragStart.value || !dragEnd.value) return null
  return {
    frameStart: Math.min(dragStart.value.frame, dragEnd.value.frame),
    frameEnd:   Math.max(dragStart.value.frame, dragEnd.value.frame),
    ledStart:   Math.min(dragStart.value.led,   dragEnd.value.led),
    ledEnd:     Math.max(dragStart.value.led,   dragEnd.value.led),
  }
}

function getCanvasPos(e) {
  const rect = canvasRef.value.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

// ---- マウス操作 ----
function onMouseDown(e) {
  const { x, y } = getCanvasPos(e)
  const cell = cellAt(x, y)
  if (!cell) return

  if (paintColor.value !== null) {
    const { r, g, b } = paintColor.value
    fillRange(cell.frame, cell.frame, cell.led, cell.led, r, g, b)
    isPaintDragging.value = true
    draw()
    return
  }

  isDragging.value = true
  dragStart.value = { ...cell }
  dragEnd.value = { ...cell }
  selection.value = null
}

function onMouseMove(e) {
  if (paintColor.value !== null && isPaintDragging.value) {
    const { x, y } = getCanvasPos(e)
    const cell = cellAt(x, y)
    if (!cell) return
    const { r, g, b } = paintColor.value
    fillRange(cell.frame, cell.frame, cell.led, cell.led, r, g, b)
    draw()
    return
  }

  if (!isDragging.value) return
  const { x, y } = getCanvasPos(e)
  const cell = cellAt(x, y)
  if (!cell) return
  dragEnd.value = { ...cell }
  draw()
}

function onMouseUp(e) {
  if (paintColor.value !== null && isPaintDragging.value) {
    isPaintDragging.value = false
    return
  }

  if (!isDragging.value) return
  isDragging.value = false
  const { x, y } = getCanvasPos(e)
  const cell = cellAt(x, y)
  if (!cell) { dragStart.value = null; dragEnd.value = null; return }
  dragEnd.value = { ...cell }

  const sel = getDragSelection()
  if (!sel) return
  selection.value = sel
  selectedFrame.value = sel.frameStart

  const frame = getDisplayFrame(sel.frameStart)
  const led = frame?.leds[sel.ledStart]
  if (led) pickerRgb.value = { r: led.r, g: led.g, b: led.b }

  dragStart.value = null; dragEnd.value = null
  draw()
}

function onMouseLeave() {
  if (paintColor.value !== null && isPaintDragging.value) {
    isPaintDragging.value = false
    return
  }
  if (isDragging.value) {
    isDragging.value = false
    const sel = getDragSelection()
    if (sel) { selection.value = sel; selectedFrame.value = sel.frameStart }
    dragStart.value = null; dragEnd.value = null
    draw()
  }
}

function onColorChange({ r, g, b }) {
  pickerRgb.value = { r, g, b }
  // ペイントモード中はペイント色を更新
  if (paintColor.value !== null) {
    paintColor.value = { r, g, b }
    return
  }
  const sel = selection.value
  if (!sel) return
  fillRange(sel.frameStart, sel.frameEnd, sel.ledStart, sel.ledEnd, r, g, b)
  draw()
}

function clearSelection() {
  selection.value = null; selectedFrame.value = null; draw()
}

// ---- ツールバー操作 ----
function onCopyFrame() {
  if (!selection.value) return
  const { frameStart, frameEnd, ledStart, ledEnd } = selection.value
  copyRange(frameStart, frameEnd, ledStart, ledEnd)
}
function onPasteFrame() {
  if (!selection.value) return
  pasteAt(selection.value.frameStart, selection.value.ledStart)
  draw()
}
function onDeleteFrame() {
  if (selectedFrame.value === null) return
  deleteFrame(selectedFrame.value)
  if (selectedFrame.value >= frameCount.value) selectedFrame.value = frameCount.value - 1
  selection.value = null; draw()
}
function onInsertFrame() {
  if (selectedFrame.value === null) return
  insertFrame(selectedFrame.value, selectedFrame.value); draw()
}

function toggleEditMode() {
  setEditMode(editMode.value === 'frames' ? 'keyframes' : 'frames')
  selection.value = null; draw()
}

function onMarkAsKf() {
  const sel = selection.value
  if (!sel || editMode.value !== 'keyframes') return
  for (let f = sel.frameStart; f <= sel.frameEnd; f++) {
    const frame = getDisplayFrame(f)
    for (let l = sel.ledStart; l <= sel.ledEnd; l++) {
      const led = frame?.leds[l] ?? { r: 0, g: 0, b: 0 }
      setKfCell(l, f, led.r, led.g, led.b)
    }
  }
  draw()
}

function onRemoveKfCells() {
  const sel = selection.value
  if (!sel || editMode.value !== 'keyframes') return
  removeKfCells(sel.ledStart, sel.ledEnd, sel.frameStart, sel.frameEnd)
  const frame = getDisplayFrame(sel.frameStart)
  const led = frame?.leds[sel.ledStart]
  if (led) pickerRgb.value = { r: led.r, g: led.g, b: led.b }
  draw()
}

function onSetInterp(type) {
  const sel = selection.value
  if (!sel) return
  setKfCellInterpRange(sel.ledStart, sel.ledEnd, sel.frameStart, sel.frameEnd, type)
  draw()
}

function onReverseFrames() { reverseFrames(); draw() }
function onMirrorLeds()    { mirrorLeds(); draw() }
function onInvertColors()  { invertColors(); draw() }

function updateCanvas() {
  const canvas = canvasRef.value
  if (!canvas) return
  canvas.width = canvasWidth.value; canvas.height = canvasHeight.value
  draw()
}

watch(
  [
    () => project.pattern.frames,
    () => project.pattern.kf_cells,
    () => project.pattern.edit_mode,
    () => project.layout.led_count,
    frameCount, ledCount,
  ],
  () => nextTick(updateCanvas),
  { deep: true }
)

onMounted(() => { updateCanvas() })
</script>

<style scoped>
.timeline-wrapper {
  display: flex; flex-direction: column; height: 100%; overflow: hidden; background: #111;
}

.timeline-toolbar {
  display: flex; align-items: center; gap: 5px;
  padding: 5px 8px; background: #1e1e1e;
  border-bottom: 1px solid #2a2a2a; flex-shrink: 0; flex-wrap: wrap;
}

.toolbar-row2 { padding: 4px 8px; gap: 4px; background: #191919; }

.timeline-toolbar button {
  padding: 3px 9px; background: #333; color: #ddd;
  border: 1px solid #555; border-radius: 3px; cursor: pointer; font-size: 12px;
}
.timeline-toolbar button:hover:not(:disabled) { background: #444; }
.timeline-toolbar button:disabled { opacity: 0.4; cursor: default; }

.btn-kf-mode { background: #3a3a00 !important; color: #cc8 !important; border-color: #666 !important; }
.btn-kf-mode.active { background: #5a4400 !important; color: #f0a020 !important; border-color: #f0a020 !important; }
.btn-kf-mode:hover:not(:disabled) { background: #4a4400 !important; }

.interp-select {
  background: #333; color: #ddd; border: 1px solid #555;
  border-radius: 3px; padding: 2px 5px; font-size: 12px; cursor: pointer;
}

.toolbar-sep { width: 1px; height: 18px; background: #444; margin: 0 2px; flex-shrink: 0; }
.toolbar-label { font-size: 11px; color: #888; }
.toolbar-hint { font-size: 11px; color: #555; margin-left: auto; }

/* パレット */
.palette-bar {
  display: flex; align-items: center; gap: 3px;
  padding: 5px 8px; background: #161616;
  border-bottom: 1px solid #2a2a2a; flex-shrink: 0; flex-wrap: wrap;
}

.palette-label { font-size: 11px; color: #888; margin-right: 4px; white-space: nowrap; }

.palette-swatch {
  width: 20px; height: 20px; border-radius: 2px; flex-shrink: 0;
  cursor: pointer; box-sizing: border-box;
  outline: 1px solid rgba(255,255,255,0.15);
  transition: outline 0.1s;
}
.palette-swatch:hover { outline: 2px solid rgba(255,255,255,0.55); }
.palette-swatch.selected {
  outline: 2px solid #fff;
  box-shadow: 0 0 5px rgba(255,255,255,0.4);
}

.paint-active-label {
  font-size: 11px; color: #f0a020; margin-left: 6px; white-space: nowrap;
}

.paint-cancel-btn {
  padding: 2px 8px; background: #5a3a00; color: #f0a020;
  border: 1px solid #f0a020; border-radius: 3px; cursor: pointer; font-size: 11px;
  margin-left: 2px;
}
.paint-cancel-btn:hover { background: #7a5000; }

.canvas-scroll { flex: 1; overflow: auto; background: #111; }

.color-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 10px; background: #1e1e1e; border-top: 1px solid #333;
  flex-shrink: 0; overflow-x: auto;
}

.color-bar-label { font-size: 11px; color: #888; white-space: nowrap; min-width: 160px; }

.clear-btn {
  margin-left: auto; padding: 3px 10px; background: #333; color: #999;
  border: 1px solid #555; border-radius: 3px; cursor: pointer;
  font-size: 11px; white-space: nowrap; flex-shrink: 0;
}
.clear-btn:hover { background: #444; color: #ddd; }
</style>
