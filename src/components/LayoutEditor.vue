<template>
  <div class="layout-wrapper">
    <div class="layout-toolbar">
      <span class="toolbar-label">プリセット：</span>
      <button @click="applyLayoutPreset('linear')">直線</button>
      <button @click="applyLayoutPreset('square_frame')">正方形</button>
      <button @click="applyLayoutPreset('grid')">格子</button>
      <button @click="applyLayoutPreset('circle')">円形</button>
      <div class="toolbar-sep" />
      <span class="toolbar-label">形状：</span>
      <button
        :class="['btn-shape', { active: ledShape === 'circle' }]"
        @click="setLedShape('circle')"
        title="LED形状を丸に変更">丸</button>
      <button
        :class="['btn-shape', { active: ledShape === 'square' }]"
        @click="setLedShape('square')"
        title="LED形状を四角に変更">四角</button>
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
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useProject } from '../composables/useProject.js'

const { project, setLedShape, setLedPosition, applyLayoutPreset } = useProject()

const LED_R = 14

const canvasRef = ref(null)
const areaRef = ref(null)
const ledShape = computed(() => project.layout.led_shape ?? 'circle')

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

  const xs = leds.map(l => l.x); const ys = leds.map(l => l.y)
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

  ctx.fillStyle = '#0a0a0a'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  if (tr) {
    ctx.strokeStyle = '#1e1e1e'; ctx.lineWidth = 1
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
  const shape = ledShape.value

  for (let i = 0; i < project.layout.leds.length; i++) {
    const led = project.layout.leds[i]
    const { cx, cy } = toCanvas(led.x, led.y, tr)
    const c = frame0?.leds[i]
    const isLit = c && (c.r > 0 || c.g > 0 || c.b > 0)
    const fillColor = isLit ? `rgb(${c.r},${c.g},${c.b})` : '#2a2a2a'

    // グロー（点灯時）
    if (isLit) {
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, LED_R * 2)
      grad.addColorStop(0, `rgba(${c.r},${c.g},${c.b},0.4)`)
      grad.addColorStop(1, 'transparent')
      ctx.fillStyle = grad
      if (shape === 'square') {
        ctx.fillRect(cx - LED_R * 2, cy - LED_R * 2, LED_R * 4, LED_R * 4)
      } else {
        ctx.beginPath(); ctx.arc(cx, cy, LED_R * 2, 0, Math.PI * 2); ctx.fill()
      }
    }

    // ドット本体
    const isDragged = dragId === led.id
    ctx.fillStyle = fillColor
    ctx.strokeStyle = isDragged ? '#fff' : '#555'
    ctx.lineWidth = isDragged ? 2 : 1

    if (shape === 'square') {
      ctx.fillRect(cx - LED_R, cy - LED_R, LED_R * 2, LED_R * 2)
      ctx.strokeRect(cx - LED_R + 0.5, cy - LED_R + 0.5, LED_R * 2 - 1, LED_R * 2 - 1)
    } else {
      ctx.beginPath(); ctx.arc(cx, cy, LED_R, 0, Math.PI * 2)
      ctx.fill(); ctx.stroke()
    }

    // LED番号ラベル
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
  const shape = ledShape.value
  for (let i = leds.length - 1; i >= 0; i--) {
    const { cx: ex, cy: ey } = toCanvas(leds[i].x, leds[i].y, t)
    const hit = shape === 'square'
      ? Math.abs(cx - ex) <= LED_R + 4 && Math.abs(cy - ey) <= LED_R + 4
      : Math.hypot(cx - ex, cy - ey) <= LED_R + 4
    if (hit) return leds[i].id
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
  dragId = null; frozenTransform = null
  canvasRef.value.style.cursor = 'default'
  draw()
}

function onMouseLeave() { onMouseUp() }

// ---- サイズ管理 ----
function resize() {
  const area = areaRef.value; const canvas = canvasRef.value
  if (!area || !canvas) return
  canvas.width = area.clientWidth; canvas.height = area.clientHeight
  draw()
}

let ro = null
onMounted(() => { ro = new ResizeObserver(resize); ro.observe(areaRef.value); resize() })
onUnmounted(() => ro?.disconnect())

watch(
  [() => project.layout.leds, () => project.layout.led_shape, () => project.pattern.frames[0]],
  () => { if (!frozenTransform) draw() },
  { deep: true }
)
</script>

<style scoped>
.layout-wrapper {
  display: flex; flex-direction: column; height: 100%;
  background: #0a0a0a; overflow: hidden;
}

.layout-toolbar {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 10px; background: #1e1e1e;
  border-bottom: 1px solid #333; flex-shrink: 0; flex-wrap: wrap;
}

.toolbar-label { font-size: 12px; color: #888; }
.toolbar-sep { width: 1px; height: 18px; background: #444; margin: 0 2px; flex-shrink: 0; }

.layout-toolbar button {
  padding: 3px 10px; background: #333; color: #ddd;
  border: 1px solid #555; border-radius: 3px; cursor: pointer; font-size: 12px;
}
.layout-toolbar button:hover { background: #444; }

.btn-shape { background: #2a2a2a !important; }
.btn-shape.active { background: #2d5a8e !important; color: #fff !important; border-color: #4a9eff !important; }

.toolbar-hint { font-size: 11px; color: #555; margin-left: auto; }

.canvas-area { flex: 1; overflow: hidden; }
</style>
