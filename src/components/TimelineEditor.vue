<template>
  <div class="timeline-wrapper">
    <!-- ツールバー行1：フレーム操作 -->
    <div class="timeline-toolbar">
      <button @click="addFrame">＋追加</button>
      <button @click="onCopyFrame" :disabled="selectedFrame === null">コピー</button>
      <button @click="onPasteFrame" :disabled="selectedFrame === null">ペースト</button>
      <button @click="onDeleteFrame" :disabled="selectedFrame === null || frameCount <= 1">削除</button>
      <button @click="onInsertFrame" :disabled="selectedFrame === null">後ろに挿入</button>
      <div class="toolbar-sep" />
      <!-- キーフレームモード切替 -->
      <button
        :class="['btn-kf-mode', { active: editMode === 'keyframes' }]"
        @click="toggleEditMode"
        title="キーフレーム補間モードに切り替え"
      >キーフレーム</button>
      <!-- キーフレームモード時の追加操作 -->
      <template v-if="editMode === 'keyframes'">
        <button @click="onRemoveKeyframe"
          :disabled="selectedFrame === null || !isKeyframe(selectedFrame)"
          title="選択フレームのキーフレームを削除">KF削除</button>
        <select v-if="selectedFrame !== null && isKeyframe(selectedFrame)"
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
      <button @click="reverseFrames" title="フレームの順序を反転">フレーム反転</button>
      <button @click="mirrorLeds" title="LED番号の順序を反転">LED反転</button>
      <button @click="invertColors" title="全セルの色を反転">色反転</button>
      <span class="toolbar-hint">クリック：色設定　ドラッグ：範囲選択</span>
    </div>

    <!-- キャンバス（スクロール可） -->
    <div class="canvas-scroll" ref="scrollRef">
      <canvas
        ref="canvasRef"
        @mousedown="onMouseDown"
        @mousemove="onMouseMove"
        @mouseup="onMouseUp"
        @mouseleave="onMouseLeave"
        style="display:block;cursor:crosshair"
      />
    </div>

    <!-- カラーピッカーバー（下部固定） -->
    <div class="color-bar">
      <span class="color-bar-label">{{ selectionLabel }}</span>
      <ColorPicker
        :modelValue="pickerRgb"
        :disabled="selection === null"
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
  addKeyframe,
  removeKeyframe,
  isKeyframe,
  setKeyframeInterpolation,
  getDisplayFrame,
  fillRange,
  addFrame,
  insertFrame,
  deleteFrame,
  copyFrame,
  pasteFrame,
  reverseFrames,
  mirrorLeds,
  invertColors,
} = useProject()

const CELL_W = 32
const CELL_H = 28
const HEADER_H = 24
const LABEL_W = 36

const canvasRef = ref(null)
const scrollRef = ref(null)

const dragStart = ref(null)
const dragEnd = ref(null)
const isDragging = ref(false)
const selection = ref(null)
const selectedFrame = ref(null)
const pickerRgb = ref({ r: 0, g: 0, b: 0 })

const frameCount = computed(() => project.pattern.frame_count)
const ledCount = computed(() => project.layout.led_count)
const editMode = computed(() => project.pattern.edit_mode)

const selectedKfInterp = computed(() => {
  if (selectedFrame.value === null) return 'linear'
  const kf = project.pattern.keyframes.find(k => k.frame === selectedFrame.value)
  return kf?.interpolation ?? 'linear'
})

const selectionLabel = computed(() => {
  const sel = selection.value
  if (!sel) return 'セルをクリック / ドラッグで色を設定'
  if (sel.frameStart === sel.frameEnd && sel.ledStart === sel.ledEnd) {
    return `フレーム ${sel.frameStart}  /  LED ${sel.ledStart}`
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
  const kfSet = isKfMode ? new Set(project.pattern.keyframes.map(k => k.frame)) : null

  // フレーム番号ヘッダ
  ctx.fillStyle = '#2a2a2a'
  ctx.fillRect(LABEL_W, 0, canvas.width - LABEL_W, HEADER_H)
  ctx.font = '10px monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let f = 0; f < frameCount.value; f++) {
    const x = LABEL_W + f * CELL_W + CELL_W / 2
    // キーフレーム列：橙色の列背景
    if (isKfMode && kfSet.has(f)) {
      ctx.fillStyle = '#3a2800'
      ctx.fillRect(LABEL_W + f * CELL_W, 0, CELL_W, HEADER_H)
    }
    ctx.fillStyle = (isKfMode && kfSet.has(f)) ? '#f0a020' : '#aaa'
    ctx.fillText(String(f), x, HEADER_H / 2)
  }

  // キーフレームダイヤマーカー
  if (isKfMode) {
    ctx.fillStyle = '#f0a020'
    for (const f of kfSet) {
      const cx = LABEL_W + f * CELL_W + CELL_W / 2
      const cy = HEADER_H - 4
      ctx.beginPath()
      ctx.moveTo(cx, cy - 5); ctx.lineTo(cx + 4, cy)
      ctx.lineTo(cx, cy + 4); ctx.lineTo(cx - 4, cy)
      ctx.closePath(); ctx.fill()
    }
  }

  // LED番号ラベル
  ctx.fillStyle = '#2a2a2a'
  ctx.fillRect(0, HEADER_H, LABEL_W, canvas.height - HEADER_H)
  ctx.fillStyle = '#aaa'
  ctx.font = '10px monospace'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let l = 0; l < ledCount.value; l++) {
    ctx.fillText(String(l), LABEL_W - 4, HEADER_H + l * CELL_H + CELL_H / 2)
  }

  // セル描画
  for (let f = 0; f < frameCount.value; f++) {
    const frame = getDisplayFrame(f)
    const isKF = isKfMode && kfSet.has(f)
    const isInterp = isKfMode && !isKF

    for (let l = 0; l < ledCount.value; l++) {
      const led = frame?.leds[l]
      if (!led) continue
      const x = LABEL_W + f * CELL_W
      const y = HEADER_H + l * CELL_H

      const isBlack = led.r === 0 && led.g === 0 && led.b === 0
      ctx.fillStyle = isBlack ? '#1a1a1a' : `rgb(${led.r},${led.g},${led.b})`
      ctx.fillRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2)

      // 補間セル：半透明オーバーレイで区別
      if (isInterp) {
        ctx.fillStyle = 'rgba(0,0,0,0.35)'
        ctx.fillRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2)
      }
    }
  }

  // 選択範囲ハイライト
  const sel = isDragging.value ? getDragSelection() : selection.value
  if (sel) {
    const x = LABEL_W + sel.frameStart * CELL_W
    const y = HEADER_H + sel.ledStart * CELL_H
    const w = (sel.frameEnd - sel.frameStart + 1) * CELL_W
    const h = (sel.ledEnd - sel.ledStart + 1) * CELL_H
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
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

function onMouseDown(e) {
  const { x, y } = getCanvasPos(e)
  const cell = cellAt(x, y)
  if (!cell) return
  isDragging.value = true
  dragStart.value = { ...cell }
  dragEnd.value = { ...cell }
  selection.value = null
}

function onMouseMove(e) {
  if (!isDragging.value) return
  const { x, y } = getCanvasPos(e)
  const cell = cellAt(x, y)
  if (!cell) return
  dragEnd.value = { ...cell }
  draw()
}

function onMouseUp(e) {
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

  // ピッカーに選択先頭セルの色を反映（getDisplayFrame を使用）
  const frame = getDisplayFrame(sel.frameStart)
  const led = frame?.leds[sel.ledStart]
  if (led) pickerRgb.value = { r: led.r, g: led.g, b: led.b }

  dragStart.value = null
  dragEnd.value = null
  draw()
}

function onMouseLeave() {
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
  const sel = selection.value
  if (!sel) return
  fillRange(sel.frameStart, sel.frameEnd, sel.ledStart, sel.ledEnd, r, g, b)
  draw()
}

function clearSelection() {
  selection.value = null; selectedFrame.value = null; draw()
}

// ---- ツールバー操作 ----

function onCopyFrame()   { if (selectedFrame.value !== null) copyFrame(selectedFrame.value) }
function onPasteFrame()  { if (selectedFrame.value !== null) { pasteFrame(selectedFrame.value); draw() } }
function onDeleteFrame() {
  if (selectedFrame.value === null) return
  deleteFrame(selectedFrame.value)
  if (selectedFrame.value >= frameCount.value) selectedFrame.value = frameCount.value - 1
  draw()
}
function onInsertFrame() {
  if (selectedFrame.value === null) return
  insertFrame(selectedFrame.value, selectedFrame.value); draw()
}

function toggleEditMode() {
  setEditMode(editMode.value === 'frames' ? 'keyframes' : 'frames')
  draw()
}

function onRemoveKeyframe() {
  if (selectedFrame.value === null) return
  removeKeyframe(selectedFrame.value); draw()
}

function onSetInterp(type) {
  if (selectedFrame.value === null) return
  setKeyframeInterpolation(selectedFrame.value, type); draw()
}

// 変換（即時描画）
function onReverseFrames()  { reverseFrames(); draw() }
function onMirrorLeds()     { mirrorLeds(); draw() }
function onInvertColors()   { invertColors(); draw() }

function updateCanvas() {
  const canvas = canvasRef.value
  if (!canvas) return
  canvas.width = canvasWidth.value
  canvas.height = canvasHeight.value
  draw()
}

watch(
  [
    () => project.pattern.frames,
    () => project.pattern.keyframes,
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

.toolbar-row2 {
  padding: 4px 8px; gap: 4px; background: #191919;
}

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

.canvas-scroll { flex: 1; overflow: auto; background: #111; }

.color-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 10px; background: #1e1e1e; border-top: 1px solid #333;
  flex-shrink: 0; overflow-x: auto;
}

.color-bar-label { font-size: 11px; color: #888; white-space: nowrap; min-width: 140px; }

.clear-btn {
  margin-left: auto; padding: 3px 10px; background: #333; color: #999;
  border: 1px solid #555; border-radius: 3px; cursor: pointer;
  font-size: 11px; white-space: nowrap; flex-shrink: 0;
}
.clear-btn:hover { background: #444; color: #ddd; }
</style>
