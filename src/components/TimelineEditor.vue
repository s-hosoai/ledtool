<template>
  <div class="timeline-wrapper">
    <!-- ツールバー -->
    <div class="timeline-toolbar">
      <button @click="addFrame">＋フレーム追加</button>
      <button @click="onCopyFrame" :disabled="selectedFrame === null">コピー</button>
      <button @click="onPasteFrame" :disabled="selectedFrame === null">ペースト</button>
      <button @click="onDeleteFrame" :disabled="selectedFrame === null || frameCount <= 1">削除</button>
      <button @click="onInsertFrame" :disabled="selectedFrame === null">後ろに挿入</button>
      <span class="toolbar-hint">クリック：色設定　ドラッグ：範囲選択</span>
    </div>

    <!-- キャンバスラッパー（スクロール可） -->
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

    <!-- カラーピッカーバー（下部固定・常時表示） -->
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
  setLedColor,
  fillRange,
  addFrame,
  insertFrame,
  deleteFrame,
  copyFrame,
  pasteFrame,
} = useProject()

const CELL_W = 32  // 1フレームの幅(px)
const CELL_H = 28  // 1LEDの高さ(px)
const HEADER_H = 24 // フレーム番号ヘッダの高さ
const LABEL_W = 36  // LED番号ラベルの幅

const canvasRef = ref(null)
const scrollRef = ref(null)

// ドラッグ選択状態
const dragStart = ref(null)  // { frame, led }
const dragEnd = ref(null)
const isDragging = ref(false)

// 選択範囲（確定済み）
const selection = ref(null)  // { frameStart, frameEnd, ledStart, ledEnd }

const selectedFrame = ref(null)  // コンテキスト操作用（最後にクリックしたフレーム列）
const pickerRgb = ref({ r: 0, g: 0, b: 0 })

const selectionLabel = computed(() => {
  const sel = selection.value
  if (!sel) return 'セルをクリック / ドラッグで色を設定'
  if (sel.frameStart === sel.frameEnd && sel.ledStart === sel.ledEnd) {
    return `フレーム ${sel.frameStart}  /  LED ${sel.ledStart}`
  }
  return `フレーム ${sel.frameStart}〜${sel.frameEnd}  /  LED ${sel.ledStart}〜${sel.ledEnd}`
})

const frameCount = computed(() => project.pattern.frame_count)
const ledCount = computed(() => project.layout.led_count)

// キャンバスサイズ
const canvasWidth = computed(() => LABEL_W + frameCount.value * CELL_W)
const canvasHeight = computed(() => HEADER_H + ledCount.value * CELL_H)

function cellAt(x, y) {
  const frameIdx = Math.floor((x - LABEL_W) / CELL_W)
  const ledIdx = Math.floor((y - HEADER_H) / CELL_H)
  if (frameIdx < 0 || frameIdx >= frameCount.value) return null
  if (ledIdx < 0 || ledIdx >= ledCount.value) return null
  return { frame: frameIdx, led: ledIdx }
}

function draw() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  // フレーム番号ヘッダ
  ctx.fillStyle = '#2a2a2a'
  ctx.fillRect(LABEL_W, 0, canvas.width - LABEL_W, HEADER_H)
  ctx.fillStyle = '#aaa'
  ctx.font = '10px monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let f = 0; f < frameCount.value; f++) {
    const x = LABEL_W + f * CELL_W + CELL_W / 2
    ctx.fillText(String(f), x, HEADER_H / 2)
  }

  // LED番号ラベル列
  ctx.fillStyle = '#2a2a2a'
  ctx.fillRect(0, HEADER_H, LABEL_W, canvas.height - HEADER_H)
  ctx.fillStyle = '#aaa'
  ctx.font = '10px monospace'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let l = 0; l < ledCount.value; l++) {
    const y = HEADER_H + l * CELL_H + CELL_H / 2
    ctx.fillText(String(l), LABEL_W - 4, y)
  }

  // セル描画
  for (let f = 0; f < frameCount.value; f++) {
    const frame = project.pattern.frames[f]
    if (!frame) continue
    for (let l = 0; l < ledCount.value; l++) {
      const led = frame.leds[l]
      if (!led) continue
      const x = LABEL_W + f * CELL_W
      const y = HEADER_H + l * CELL_H

      // 色塗り
      const isBlack = led.r === 0 && led.g === 0 && led.b === 0
      ctx.fillStyle = isBlack
        ? '#1a1a1a'
        : `rgb(${led.r},${led.g},${led.b})`
      ctx.fillRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2)
    }
  }

  // 選択範囲ハイライト（ドラッグ中 or 確定済み）
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
    frameEnd: Math.max(dragStart.value.frame, dragEnd.value.frame),
    ledStart: Math.min(dragStart.value.led, dragEnd.value.led),
    ledEnd: Math.max(dragStart.value.led, dragEnd.value.led),
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

  const isClick =
    sel.frameStart === sel.frameEnd && sel.ledStart === sel.ledEnd

  selection.value = sel
  selectedFrame.value = sel.frameStart
  // 選択先頭セルの色をピッカーに反映
  const led = project.pattern.frames[sel.frameStart]?.leds[sel.ledStart]
  if (led) pickerRgb.value = { r: led.r, g: led.g, b: led.b }

  dragStart.value = null
  dragEnd.value = null
  draw()
}

function onMouseLeave() {
  if (isDragging.value) {
    isDragging.value = false
    const sel = getDragSelection()
    if (sel) {
      selection.value = sel
      selectedFrame.value = sel.frameStart
    }
    dragStart.value = null
    dragEnd.value = null
    draw()
  }
}

// ColorPicker からの色変更を即時適用
function onColorChange({ r, g, b }) {
  pickerRgb.value = { r, g, b }
  const sel = selection.value
  if (!sel) return
  fillRange(sel.frameStart, sel.frameEnd, sel.ledStart, sel.ledEnd, r, g, b)
  draw()
}

function clearSelection() {
  selection.value = null
  selectedFrame.value = null
  draw()
}

// ツールバー操作
function onCopyFrame() {
  if (selectedFrame.value === null) return
  copyFrame(selectedFrame.value)
}

function onPasteFrame() {
  if (selectedFrame.value === null) return
  pasteFrame(selectedFrame.value)
  draw()
}

function onDeleteFrame() {
  if (selectedFrame.value === null) return
  deleteFrame(selectedFrame.value)
  if (selectedFrame.value >= frameCount.value) {
    selectedFrame.value = frameCount.value - 1
  }
  draw()
}

function onInsertFrame() {
  if (selectedFrame.value === null) return
  insertFrame(selectedFrame.value, selectedFrame.value)
  draw()
}

// キャンバスサイズ更新と再描画
function updateCanvas() {
  const canvas = canvasRef.value
  if (!canvas) return
  canvas.width = canvasWidth.value
  canvas.height = canvasHeight.value
  draw()
}

watch(
  [() => project.pattern.frames, () => project.layout.led_count, frameCount, ledCount],
  () => nextTick(updateCanvas),
  { deep: true }
)

onMounted(() => {
  updateCanvas()
})
</script>

<style scoped>
.timeline-wrapper {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: #111;
}

.timeline-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: #1e1e1e;
  border-bottom: 1px solid #333;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.timeline-toolbar button {
  padding: 3px 10px;
  background: #333;
  color: #ddd;
  border: 1px solid #555;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
}

.timeline-toolbar button:hover:not(:disabled) {
  background: #444;
}

.timeline-toolbar button:disabled {
  opacity: 0.4;
  cursor: default;
}

.toolbar-hint {
  font-size: 11px;
  color: #666;
  margin-left: auto;
}

.canvas-scroll {
  flex: 1;
  overflow: auto;
  background: #111;
}

.color-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  background: #1e1e1e;
  border-top: 1px solid #333;
  flex-shrink: 0;
  overflow-x: auto;
}

.color-bar-label {
  font-size: 11px;
  color: #888;
  white-space: nowrap;
  min-width: 140px;
}

.clear-btn {
  margin-left: auto;
  padding: 3px 10px;
  background: #333;
  color: #999;
  border: 1px solid #555;
  border-radius: 3px;
  cursor: pointer;
  font-size: 11px;
  white-space: nowrap;
  flex-shrink: 0;
}

.clear-btn:hover {
  background: #444;
  color: #ddd;
}
</style>
