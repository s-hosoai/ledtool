<template>
  <div class="timeline-wrapper">
    <!-- ツールバー（1行） -->
    <div class="timeline-toolbar">
      <!-- フレーム操作 -->
      <button @click="onAddFrame" title="フレームを末尾に追加">＋追加</button>
      <button @click="onDeleteFrame" :disabled="selectedFrame === null || frameCount <= 1" title="選択フレームを削除 [Delete]">削除</button>
      <button @click="onInsertFrame" :disabled="selectedFrame === null" title="選択フレームの後ろに挿入">挿入</button>
      <div class="toolbar-sep" />

      <!-- ツール切替 -->
      <button :class="['btn-tool', { active: editTool === 'paint' }]" @click="editTool = 'paint'" title="ペイントモード：クリック/ドラッグで塗る">🖊 ペイント</button>
      <button :class="['btn-tool', { active: editTool === 'select' }]" @click="editTool = 'select'" title="選択モード：ドラッグで範囲選択、コピー/ペースト用">□ 選択</button>
      <div class="toolbar-sep" />

      <!-- コピー・ペースト・Undo -->
      <button @click="onCopy" :disabled="!hasRangeSelection" title="選択範囲をコピー [Ctrl+C]">コピー</button>
      <button @click="onPaste" :disabled="selection === null || !hasCopied" title="選択位置にペースト [Ctrl+V]">ペースト</button>
      <button @click="onUndo" :disabled="!canUndo" title="元に戻す [Ctrl+Z]">↩ 戻す</button>
      <div class="toolbar-sep" />

      <!-- 変換ドロップダウン -->
      <div class="dropdown-wrap">
        <button
          :class="['btn-transform', { active: showTransform }]"
          @click.stop="showTransform = !showTransform"
          title="変換メニュー">変換 ▾</button>
        <div v-if="showTransform" class="dropdown-menu">
          <button @click="onReverseFrames">フレーム反転</button>
          <button @click="onMirrorLeds">LED反転</button>
          <button @click="onInvertColors">色反転</button>
        </div>
      </div>
      <div class="toolbar-sep" />

      <!-- キーフレームモード -->
      <button :class="['btn-kf-mode', { active: editMode === 'keyframes' }]" @click="onToggleEditMode" title="キーフレーム補間モード">キーフレーム</button>
      <template v-if="editMode === 'keyframes'">
        <button @click="onMarkAsKf" :disabled="selection === null" title="選択セルをKFに設定">KFにする</button>
        <button @click="onRemoveKfCells" :disabled="!selectionHasKf" title="選択セルのKFを解除">KF解除</button>
        <select v-if="showInterpSelect" :value="selectedKfInterp" @change="onSetInterp($event.target.value)" class="interp-select">
          <option value="linear">線形</option>
          <option value="step">ステップ</option>
        </select>
      </template>
    </div>

    <!-- パレット行 -->
    <div class="palette-bar">
      <span class="palette-label">色：</span>

      <!-- 通常モード：適用 / 編集モード：選択 -->
      <div class="palette-swatches">
        <div
          v-for="(color, i) in palette"
          :key="i"
          class="swatch-wrap"
        >
          <div
            class="palette-swatch"
            :class="{ 'swatch-editing': paletteEditMode && paletteEditIdx === i }"
            :style="{ background: `rgb(${color.r},${color.g},${color.b})` }"
            @click="onSwatchClick(color, i)"
            :title="paletteEditMode ? `スウォッチ${i}を編集` : `RGB(${color.r},${color.g},${color.b})`"
          />
          <button v-if="paletteEditMode" class="swatch-del" @click.stop="onDeleteSwatch(i)" title="削除">×</button>
        </div>

        <!-- 編集モード時：現在色を追加ボタン -->
        <button v-if="paletteEditMode" class="btn-add-swatch" @click="onAddSwatch" title="現在の色を追加">
          <span class="add-swatch-preview" :style="{ background: `rgb(${pickerRgb.r},${pickerRgb.g},${pickerRgb.b})` }" />
          ＋
        </button>
      </div>

      <div class="palette-bar-actions">
        <button
          :class="['btn-palette-edit', { active: paletteEditMode }]"
          @click="togglePaletteEdit"
          :title="paletteEditMode ? 'パレット編集を終了' : 'パレットの色を追加・変更'">
          {{ paletteEditMode ? '✓ 完了' : '✏ 編集' }}
        </button>
        <span v-if="!paletteEditMode" class="palette-mode-hint">
          <template v-if="editTool === 'paint'">クリック/ドラッグで塗る</template>
          <template v-else-if="hasRangeSelection">パレットクリックで選択範囲を塗りつぶし</template>
          <template v-else>ドラッグで範囲選択 → コピー/ペースト</template>
        </span>
        <span v-else class="palette-mode-hint">スウォッチをクリックして選択 → カラーピッカーで色を変更</span>
      </div>
    </div>

    <!-- キャンバス（スクロール可） -->
    <div class="canvas-scroll" ref="scrollRef">
      <canvas
        ref="canvasRef"
        @mousedown="onMouseDown"
        @mousemove="onMouseMove"
        @mouseup="onMouseUp"
        @mouseleave="onMouseLeave"
        :style="{ display: 'block', cursor: editTool === 'paint' ? 'cell' : 'crosshair' }"
      />
    </div>

    <!-- カラーピッカーバー -->
    <div class="color-bar">
      <span class="color-bar-label">{{ selectionLabel }}</span>
      <ColorPicker :modelValue="pickerRgb" @update:modelValue="onColorChange" />
      <button
        v-if="editTool === 'select' && hasRangeSelection && !paletteEditMode"
        class="fill-btn"
        @click="onFillSelection"
        title="現在の色で選択範囲を塗りつぶす">
        ✓ 選択範囲を塗る
      </button>
      <button v-if="selection !== null" class="clear-btn" @click="clearSelection">✕ 選択解除</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
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
  canUndo,
  copyRange,
  pasteAt,
  saveSnapshot,
  undo,
  reverseFrames,
  mirrorLeds,
  invertColors,
} = useProject()

const CELL_W = 32
const CELL_H = 28
const HEADER_H = 24
const LABEL_W = 36

const PALETTE_DEFAULTS = [
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
const pickerRgb = ref({ r: 0, g: 0, b: 0 })

// ---- パレット ----
const palette = ref(PALETTE_DEFAULTS.map(c => ({ ...c })))
const paletteEditMode = ref(false)
const paletteEditIdx = ref(null)

function togglePaletteEdit() {
  paletteEditMode.value = !paletteEditMode.value
  paletteEditIdx.value = null
}

function onSwatchClick(color, idx) {
  if (paletteEditMode.value) {
    paletteEditIdx.value = idx
    pickerRgb.value = { ...color }
  } else {
    onPaletteClick(color)
  }
}

function onAddSwatch() {
  palette.value.push({ ...pickerRgb.value })
  paletteEditIdx.value = palette.value.length - 1
}

function onDeleteSwatch(idx) {
  palette.value.splice(idx, 1)
  if (paletteEditIdx.value === idx) paletteEditIdx.value = null
  else if (paletteEditIdx.value !== null && paletteEditIdx.value > idx) paletteEditIdx.value -= 1
}

// ---- ツール・UI状態 ----
const editTool = ref('paint')       // 'paint' | 'select'
const isPainting = ref(false)
const showTransform = ref(false)

// ---- 選択状態 ----
const isDragging = ref(false)
const dragStart = ref(null)
const dragEnd = ref(null)
const selection = ref(null)
const selectedFrame = ref(null)

const frameCount = computed(() => project.pattern.frame_count)
const ledCount = computed(() => project.layout.led_count)
const editMode = computed(() => project.pattern.edit_mode)

const hasRangeSelection = computed(() => {
  const sel = selection.value
  return sel !== null && (sel.frameStart !== sel.frameEnd || sel.ledStart !== sel.ledEnd)
})

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
  if (!sel) return `現在色：RGB(${pickerRgb.value.r}, ${pickerRgb.value.g}, ${pickerRgb.value.b})`
  if (sel.frameStart === sel.frameEnd && sel.ledStart === sel.ledEnd) {
    const kfInfo = editMode.value === 'keyframes'
      ? (isKfCell(sel.ledStart, sel.frameStart) ? ' ◆KF' : ' 補間') : ''
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

  // ヘッダ
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

  // LEDラベル
  ctx.fillStyle = '#2a2a2a'; ctx.fillRect(0, HEADER_H, LABEL_W, canvas.height - HEADER_H)
  ctx.fillStyle = '#aaa'; ctx.font = '10px monospace'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
  for (let l = 0; l < ledCount.value; l++) {
    ctx.fillText(String(l), LABEL_W - 4, HEADER_H + l * CELL_H + CELL_H / 2)
  }

  // セル
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

  // 選択ハイライト（選択モード時）
  const sel = isDragging.value ? getDragSelection() : selection.value
  if (sel && editTool.value === 'select') {
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
  if (e.button !== 0) return
  const { x, y } = getCanvasPos(e)
  const cell = cellAt(x, y)
  if (!cell) return

  selectedFrame.value = cell.frame

  if (editTool.value === 'paint') {
    saveSnapshot()
    const { r, g, b } = pickerRgb.value
    fillRange(cell.frame, cell.frame, cell.led, cell.led, r, g, b)
    isPainting.value = true
    draw()
  } else {
    isDragging.value = true
    dragStart.value = { ...cell }
    dragEnd.value = { ...cell }
    selection.value = null
    draw()
  }
}

function onMouseMove(e) {
  if (editTool.value === 'paint' && isPainting.value) {
    const { x, y } = getCanvasPos(e)
    const cell = cellAt(x, y)
    if (!cell) return
    const { r, g, b } = pickerRgb.value
    fillRange(cell.frame, cell.frame, cell.led, cell.led, r, g, b)
    selectedFrame.value = cell.frame
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
  if (editTool.value === 'paint' && isPainting.value) {
    isPainting.value = false
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
  isPainting.value = false
  if (isDragging.value) {
    isDragging.value = false
    const sel = getDragSelection()
    if (sel) { selection.value = sel; selectedFrame.value = sel.frameStart }
    dragStart.value = null; dragEnd.value = null
    draw()
  }
}

// ---- 色操作 ----
function onPaletteClick(color) {
  pickerRgb.value = { ...color }
  if (editTool.value === 'select' && hasRangeSelection.value) {
    saveSnapshot()
    const { frameStart, frameEnd, ledStart, ledEnd } = selection.value
    fillRange(frameStart, frameEnd, ledStart, ledEnd, color.r, color.g, color.b)
    draw()
  }
}

function onColorChange({ r, g, b }) {
  pickerRgb.value = { r, g, b }
  // パレット編集中は選択スウォッチの色をリアルタイム更新
  if (paletteEditMode.value && paletteEditIdx.value !== null) {
    palette.value[paletteEditIdx.value] = { r, g, b }
  }
}

function onFillSelection() {
  if (!hasRangeSelection.value) return
  saveSnapshot()
  const { frameStart, frameEnd, ledStart, ledEnd } = selection.value
  fillRange(frameStart, frameEnd, ledStart, ledEnd, pickerRgb.value.r, pickerRgb.value.g, pickerRgb.value.b)
  draw()
}

function clearSelection() {
  selection.value = null; draw()
}

// ---- ツールバー操作 ----
function onAddFrame() { saveSnapshot(); addFrame(); }
function onDeleteFrame() {
  if (selectedFrame.value === null) return
  saveSnapshot(); deleteFrame(selectedFrame.value)
  if (selectedFrame.value >= frameCount.value) selectedFrame.value = frameCount.value - 1
  selection.value = null; draw()
}
function onInsertFrame() {
  if (selectedFrame.value === null) return
  saveSnapshot(); insertFrame(selectedFrame.value, selectedFrame.value); draw()
}

function onCopy() {
  if (!hasRangeSelection.value) return
  const { frameStart, frameEnd, ledStart, ledEnd } = selection.value
  copyRange(frameStart, frameEnd, ledStart, ledEnd)
}
function onPaste() {
  if (!selection.value) return
  saveSnapshot(); pasteAt(selection.value.frameStart, selection.value.ledStart); draw()
}
function onUndo() { undo(); draw() }

function onToggleEditMode() {
  saveSnapshot()
  setEditMode(editMode.value === 'frames' ? 'keyframes' : 'frames')
  selection.value = null; draw()
}

function onMarkAsKf() {
  const sel = selection.value
  if (!sel || editMode.value !== 'keyframes') return
  saveSnapshot()
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
  saveSnapshot()
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

function onReverseFrames() { saveSnapshot(); reverseFrames(); showTransform.value = false; draw() }
function onMirrorLeds()    { saveSnapshot(); mirrorLeds();    showTransform.value = false; draw() }
function onInvertColors()  { saveSnapshot(); invertColors();  showTransform.value = false; draw() }

// ---- キーボード・ドロップダウン外側クリック ----
function handleKeyDown(e) {
  const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
  if (isInput) return
  if (e.ctrlKey && e.key === 'z') { onUndo(); e.preventDefault() }
  if (e.ctrlKey && e.key === 'c') { onCopy(); e.preventDefault() }
  if (e.ctrlKey && e.key === 'v') { onPaste(); e.preventDefault() }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedFrame.value !== null && frameCount.value > 1) onDeleteFrame()
    e.preventDefault()
  }
}

function handleMouseDown(e) {
  if (showTransform.value && !e.target.closest('.dropdown-wrap')) {
    showTransform.value = false
  }
}

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

onMounted(() => {
  updateCanvas()
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('mousedown', handleMouseDown)
})
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('mousedown', handleMouseDown)
})
</script>

<style scoped>
.timeline-wrapper {
  display: flex; flex-direction: column; height: 100%; overflow: hidden; background: #111;
}

/* ---- ツールバー ---- */
.timeline-toolbar {
  display: flex; align-items: center; gap: 4px;
  padding: 5px 8px; background: #1e1e1e;
  border-bottom: 1px solid #2a2a2a; flex-shrink: 0; flex-wrap: wrap;
}

.timeline-toolbar button {
  padding: 3px 9px; background: #333; color: #ddd;
  border: 1px solid #555; border-radius: 3px; cursor: pointer; font-size: 12px;
  white-space: nowrap;
}
.timeline-toolbar button:hover:not(:disabled) { background: #444; }
.timeline-toolbar button:disabled { opacity: 0.35; cursor: default; }

.btn-tool { background: #2a2a2a !important; }
.btn-tool.active { background: #2d5a8e !important; color: #9cf !important; border-color: #4a9eff !important; }

.btn-kf-mode { background: #3a3a00 !important; color: #cc8 !important; border-color: #666 !important; }
.btn-kf-mode.active { background: #5a4400 !important; color: #f0a020 !important; border-color: #f0a020 !important; }

.interp-select {
  background: #333; color: #ddd; border: 1px solid #555;
  border-radius: 3px; padding: 2px 5px; font-size: 12px; cursor: pointer;
}

.toolbar-sep { width: 1px; height: 18px; background: #444; margin: 0 2px; flex-shrink: 0; }

/* ---- 変換ドロップダウン ---- */
.dropdown-wrap { position: relative; display: inline-block; }

.btn-transform { background: #2a2a2a !important; }
.btn-transform.active { background: #3a3a1a !important; border-color: #888 !important; }

.dropdown-menu {
  position: absolute; top: calc(100% + 4px); left: 0; z-index: 200;
  background: #252525; border: 1px solid #555; border-radius: 5px;
  min-width: 120px; box-shadow: 0 6px 16px rgba(0,0,0,0.5);
  padding: 4px 0; white-space: nowrap;
}
.dropdown-menu button {
  display: block; width: 100%; text-align: left;
  padding: 7px 16px; background: transparent !important;
  border: none !important; border-radius: 0 !important;
  color: #ddd !important; cursor: pointer; font-size: 12px;
}
.dropdown-menu button:hover { background: #3a3a3a !important; }

/* ---- パレット ---- */
.palette-bar {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 8px; background: #161616;
  border-bottom: 1px solid #2a2a2a; flex-shrink: 0; flex-wrap: wrap;
}
.palette-label { font-size: 11px; color: #888; white-space: nowrap; }
.palette-swatches { display: flex; align-items: center; gap: 3px; flex-wrap: wrap; }

.swatch-wrap { position: relative; display: inline-block; }
.palette-swatch {
  width: 20px; height: 20px; border-radius: 2px; flex-shrink: 0;
  cursor: pointer; outline: 1px solid rgba(255,255,255,0.15);
  display: block;
}
.palette-swatch:hover { outline: 2px solid rgba(255,255,255,0.6); }
.palette-swatch.swatch-editing { outline: 2px solid #4af !important; box-shadow: 0 0 0 1px #4af; }
.swatch-del {
  position: absolute; top: -5px; right: -5px;
  width: 13px; height: 13px; border-radius: 50%;
  background: #c33; color: #fff; border: none;
  font-size: 9px; line-height: 1; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  padding: 0; z-index: 10;
}
.swatch-del:hover { background: #e44; }

.btn-add-swatch {
  display: flex; align-items: center; gap: 3px;
  padding: 2px 7px; background: #2a2a2a; color: #aaa;
  border: 1px dashed #555; border-radius: 3px; cursor: pointer; font-size: 12px;
  height: 22px; flex-shrink: 0;
}
.btn-add-swatch:hover { background: #333; color: #ddd; }
.add-swatch-preview {
  width: 12px; height: 12px; border-radius: 2px; outline: 1px solid rgba(255,255,255,0.3); flex-shrink: 0;
}

.palette-bar-actions {
  display: flex; align-items: center; gap: 8px; margin-left: 4px;
}
.btn-palette-edit {
  padding: 2px 9px; background: #2a2a2a; color: #999;
  border: 1px solid #555; border-radius: 3px; cursor: pointer; font-size: 11px;
  white-space: nowrap; flex-shrink: 0;
}
.btn-palette-edit:hover { background: #333; color: #ddd; }
.btn-palette-edit.active { background: #1a3a2a; color: #6f6; border-color: #4a8; }

.palette-mode-hint { font-size: 11px; color: #666; white-space: nowrap; }

/* ---- キャンバス ---- */
.canvas-scroll { flex: 1; overflow: auto; background: #111; }

/* ---- カラーバー ---- */
.color-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 10px; background: #1e1e1e; border-top: 1px solid #333;
  flex-shrink: 0; overflow-x: auto;
}
.color-bar-label { font-size: 11px; color: #888; white-space: nowrap; min-width: 200px; }
.fill-btn {
  padding: 3px 10px; background: #1a4a1a; color: #8f8;
  border: 1px solid #4a8; border-radius: 3px; cursor: pointer; font-size: 11px;
  white-space: nowrap; flex-shrink: 0;
}
.fill-btn:hover { background: #2a6a2a; }
.clear-btn {
  margin-left: auto; padding: 3px 10px; background: #333; color: #999;
  border: 1px solid #555; border-radius: 3px; cursor: pointer;
  font-size: 11px; white-space: nowrap; flex-shrink: 0;
}
.clear-btn:hover { background: #444; color: #ddd; }
</style>
