<template>
  <div class="layout-wrapper">
    <div class="layout-toolbar">
      <span class="toolbar-label">プリセット：</span>
      <button @click="applyLayoutPreset('linear')">直線</button>
      <button @click="applyLayoutPreset('serpentine')">蛇行</button>
      <button @click="applyLayoutPreset('grid')">格子</button>
      <button @click="applyLayoutPreset('circle')">円形</button>
      <span class="toolbar-hint">ドラッグでLEDを移動</span>
    </div>
    <div class="canvas-area" ref="areaRef">
      <canvas
        ref="canvasRef"
        @mousedown="onMouseDown"
        @mousemove="onMouseMove"
        @mouseup="onMouseUp"
        @mouseleave="onMouseLeave"
        style="display:block"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { useProject } from '../composables/useProject.js'

const { project, setLedPosition, applyLayoutPreset } = useProject()

const LED_R = 14  // LEDドットの半径(px)

const canvasRef = ref(null)
const areaRef = ref(null)

// ドラッグ状態
let dragId = null
let frozenTransform = null

// ---- 座標変換 ----
function computeTransform() {
  const canvas = canvasRef.value
  if (!canvas) return null
  const leds = project.layout.leds
  if (!leds || leds.length === 0) return null

  const PADDING = 40

  if (leds.length === 1) {
    return { scale: 1, ox: canvas.width / 2 - leds[0].x, oy: canvas.height / 2 - leds[0].y }
  }

  const xs = leds.map(l => l.x)
  const ys = leds.map(l => l.y)
  const minX = Math.min(...xs); const maxX = Math.max(...xs)
  const minY = Math.min(...ys); const maxY = Math.max(...ys)
  const lw = maxX - minX || 1; const lh = maxY - minY || 1
  const aw = canvas.width - PADDING * 2; const ah = canvas.height - PADDING * 2
  const scale = Math.min(aw / lw, ah / lh, 3)
  const ox = (canvas.width - lw * scale) / 2 - minX * scale
  const oy = (canvas.height - lh * scale) / 2 - minY * scale
  return { scale, ox, oy }
}

function toCanvas(lx, ly, t) {
  return { cx: lx * t.scale + t.ox, cy: ly * t.scale + t.oy }
}

function fromCanvas(cx, cy, t) {
  return { x: (cx - t.ox) / t.scale, y: (cy - t.oy) / t.scale }
}

// ---- 描画 ----
function draw(t) {
  const canvas = canvasRef.value
  if (!canvas) return
  const tr = t ?? computeTransform()
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  // 背景
  ctx.fillStyle = '#0a0a0a'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // グリッド（変換後の座標系でグリッドを描画）
  if (tr) {
    ctx.strokeStyle = '#1e1e1e'
    ctx.lineWidth = 1
    const gridStep = 40 * tr.scale
    if (gridStep > 8) {
      const startX = ((0 - tr.ox) % gridStep + gridStep) % gridStep
      for (let x = startX; x < canvas.width; x += gridStep) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke()
      }
      const startY = ((0 - tr.oy) % gridStep + gridStep) % gridStep
      for (let y = startY; y < canvas.height; y += gridStep) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke()
      }
    }
  }

  if (!tr) return

  const frame0 = project.pattern.frames[0]

  for (let i = 0; i < project.layout.leds.length; i++) {
    const led = project.layout.leds[i]
    const { cx, cy } = toCanvas(led.x, led.y, tr)

    // フレーム0の色（黒なら暗めの色を使用）
    const c = frame0?.leds[i]
    const isLit = c && (c.r > 0 || c.g > 0 || c.b > 0)
    const fillColor = isLit ? `rgb(${c.r},${c.g},${c.b})` : '#2a2a2a'

    // グロー（点灯時）
    if (isLit) {
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, LED_R * 2)
      grad.addColorStop(0, `rgba(${c.r},${c.g},${c.b},0.4)`)
      grad.addColorStop(1, 'transparent')
      ctx.beginPath(); ctx.arc(cx, cy, LED_R * 2, 0, Math.PI * 2)
      ctx.fillStyle = grad; ctx.fill()
    }

    // ドット
    ctx.beginPath(); ctx.arc(cx, cy, LED_R, 0, Math.PI * 2)
    ctx.fillStyle = fillColor; ctx.fill()
    ctx.strokeStyle = dragId === led.id ? '#fff' : '#555'
    ctx.lineWidth = dragId === led.id ? 2 : 1
    ctx.stroke()

    // LED番号
    ctx.fillStyle = isLit ? '#000' : '#888'
    ctx.font = `bold ${Math.max(8, Math.min(11, LED_R))}px monospace`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(String(led.id), cx, cy)
  }
}

// ---- マウス操作 ----
function getPos(e) {
  const rect = canvasRef.value.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function hitTest(cx, cy, t) {
  const leds = project.layout.leds
  for (let i = leds.length - 1; i >= 0; i--) {
    const { cx: ex, cy: ey } = toCanvas(leds[i].x, leds[i].y, t)
    if (Math.hypot(cx - ex, cy - ey) <= LED_R + 4) return leds[i].id
  }
  return null
}

function onMouseDown(e) {
  const { x, y } = getPos(e)
  frozenTransform = computeTransform()
  if (!frozenTransform) return
  dragId = hitTest(x, y, frozenTransform)
  if (dragId !== null) {
    canvasRef.value.style.cursor = 'grabbing'
    draw(frozenTransform)
  }
}

function onMouseMove(e) {
  if (dragId === null || !frozenTransform) return
  const { x, y } = getPos(e)
  const { x: lx, y: ly } = fromCanvas(x, y, frozenTransform)
  setLedPosition(dragId, lx, ly)
  draw(frozenTransform)
}

function onMouseUp() {
  dragId = null
  frozenTransform = null
  canvasRef.value.style.cursor = 'default'
  draw()
}

function onMouseLeave() {
  onMouseUp()
}

// ---- サイズ管理 ----
function resize() {
  const area = areaRef.value; const canvas = canvasRef.value
  if (!area || !canvas) return
  canvas.width = area.clientWidth
  canvas.height = area.clientHeight
  draw()
}

let ro = null
onMounted(() => {
  ro = new ResizeObserver(resize)
  ro.observe(areaRef.value)
  resize()
})
onUnmounted(() => ro?.disconnect())

watch(
  [() => project.layout.leds, () => project.pattern.frames[0]],
  () => { if (!frozenTransform) draw() },
  { deep: true }
)
</script>

<style scoped>
.layout-wrapper {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #0a0a0a;
  overflow: hidden;
}

.layout-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: #1e1e1e;
  border-bottom: 1px solid #333;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.toolbar-label { font-size: 12px; color: #888; }

.layout-toolbar button {
  padding: 3px 10px;
  background: #333;
  color: #ddd;
  border: 1px solid #555;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
}
.layout-toolbar button:hover { background: #444; }

.toolbar-hint { font-size: 11px; color: #555; margin-left: auto; }

.canvas-area {
  flex: 1;
  overflow: hidden;
}
</style>
