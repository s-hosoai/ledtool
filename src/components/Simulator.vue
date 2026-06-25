<template>
  <div class="simulator-wrapper">
    <div class="sim-controls">
      <button @click="togglePlay">{{ isPlaying ? '⏸ 一時停止' : '▶ 再生' }}</button>
      <button @click="stepBack" :disabled="isPlaying">◀ 前</button>
      <button @click="stepForward" :disabled="isPlaying">▶ 次</button>
      <label>
        速度：
        <select v-model="speedMultiplier">
          <option :value="0.25">0.25×</option>
          <option :value="0.5">0.5×</option>
          <option :value="1">1×</option>
          <option :value="2">2×</option>
          <option :value="4">4×</option>
        </select>
      </label>
      <span class="frame-info">
        フレーム {{ currentFrame }} / {{ frameCount - 1 }}
        &nbsp;|&nbsp;{{ elapsedSeconds }}秒
      </span>
    </div>
    <div class="sim-canvas-area" ref="areaRef">
      <canvas ref="canvasRef" style="display:block" />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useProject } from '../composables/useProject.js'

const { project, getDisplayFrame } = useProject()

const LED_R = 14
const OFF_COLOR = 'rgb(10,10,10)'

const canvasRef = ref(null)
const areaRef = ref(null)
const isPlaying = ref(false)
const currentFrame = ref(0)
const speedMultiplier = ref(1)

const frameCount = computed(() => project.pattern.frame_count)
const fps = computed(() => project.pattern.fps)
const loop = computed(() => project.pattern.loop)
const ledCount = computed(() => project.layout.led_count)

const elapsedSeconds = computed(() =>
  (currentFrame.value / fps.value).toFixed(2)
)

// ---- 座標変換（レイアウト座標 → キャンバス座標） ----
function computeTransform() {
  const canvas = canvasRef.value
  if (!canvas) return null
  const leds = project.layout.leds
  if (!leds || leds.length === 0) return null

  const PADDING = LED_R * 3

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

// ---- 描画 ----
function draw() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#0a0a0a'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const frame = getDisplayFrame(currentFrame.value)
  if (!frame) return

  const t = computeTransform()
  if (!t) return

  for (let i = 0; i < ledCount.value; i++) {
    const layoutLed = project.layout.leds[i]
    if (!layoutLed) continue
    const led = frame.leds[i]
    const cx = layoutLed.x * t.scale + t.ox
    const cy = layoutLed.y * t.scale + t.oy

    const isOff = !led || (led.r === 0 && led.g === 0 && led.b === 0)

    if (!isOff) {
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, LED_R * 2.5)
      grad.addColorStop(0, `rgba(${led.r},${led.g},${led.b},0.6)`)
      grad.addColorStop(1, 'transparent')
      ctx.beginPath(); ctx.arc(cx, cy, LED_R * 2.5, 0, Math.PI * 2)
      ctx.fillStyle = grad; ctx.fill()
    }

    ctx.beginPath(); ctx.arc(cx, cy, LED_R, 0, Math.PI * 2)
    ctx.fillStyle = isOff ? OFF_COLOR : `rgb(${led.r},${led.g},${led.b})`
    ctx.fill()
  }
}

// ---- 再生制御 ----
let rafId = null; let lastTime = null; let accTime = 0

function msPerFrame() { return 1000 / (fps.value * speedMultiplier.value) }

function tick(now) {
  if (lastTime === null) lastTime = now
  accTime += now - lastTime; lastTime = now
  while (accTime >= msPerFrame()) {
    accTime -= msPerFrame()
    const next = currentFrame.value + 1
    if (next >= frameCount.value) {
      if (loop.value) currentFrame.value = 0
      else { currentFrame.value = frameCount.value - 1; stopPlay(); return }
    } else {
      currentFrame.value = next
    }
  }
  draw()
  if (isPlaying.value) rafId = requestAnimationFrame(tick)
}

function startPlay() {
  isPlaying.value = true; lastTime = null; accTime = 0
  rafId = requestAnimationFrame(tick)
}

function stopPlay() {
  isPlaying.value = false
  if (rafId) { cancelAnimationFrame(rafId); rafId = null }
  draw()
}

function togglePlay() { isPlaying.value ? stopPlay() : startPlay() }
function stepBack() { currentFrame.value = Math.max(0, currentFrame.value - 1); draw() }
function stepForward() {
  const next = currentFrame.value + 1
  currentFrame.value = next < frameCount.value ? next : (loop.value ? 0 : currentFrame.value)
  draw()
}

// ---- サイズ管理 ----
function resize() {
  const area = areaRef.value; const canvas = canvasRef.value
  if (!area || !canvas) return
  canvas.width = area.clientWidth
  canvas.height = area.clientHeight
  if (!isPlaying.value) draw()
}

let ro = null
onMounted(() => {
  ro = new ResizeObserver(resize)
  ro.observe(areaRef.value)
  resize()
})

onUnmounted(() => {
  stopPlay(); ro?.disconnect()
})

watch(
  [() => project.pattern.frames, () => project.pattern.keyframes, () => project.pattern.edit_mode,
   () => project.layout.leds, currentFrame, frameCount, ledCount],
  () => { if (!isPlaying.value) draw() },
  { deep: true }
)
</script>

<style scoped>
.simulator-wrapper {
  display: flex; flex-direction: column; height: 100%;
  background: #0d0d0d; overflow: hidden;
}

.sim-controls {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; background: #1e1e1e;
  border-bottom: 1px solid #333; flex-shrink: 0; flex-wrap: wrap;
}

.sim-controls button {
  padding: 3px 10px; background: #333; color: #ddd;
  border: 1px solid #555; border-radius: 3px; cursor: pointer; font-size: 12px;
}
.sim-controls button:hover:not(:disabled) { background: #444; }
.sim-controls button:disabled { opacity: 0.4; cursor: default; }

.sim-controls label { font-size: 12px; color: #aaa; display: flex; align-items: center; gap: 4px; }

.sim-controls select {
  background: #333; color: #ddd; border: 1px solid #555;
  border-radius: 3px; padding: 2px 4px; font-size: 12px;
}

.frame-info { font-size: 12px; color: #888; margin-left: auto; }

.sim-canvas-area { flex: 1; overflow: hidden; }
</style>
