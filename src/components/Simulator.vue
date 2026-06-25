<template>
  <div class="simulator-wrapper">
    <!-- 再生コントロール -->
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
        &nbsp;|&nbsp;
        {{ elapsedSeconds }}秒
      </span>
    </div>

    <!-- LEDキャンバス -->
    <div class="sim-canvas-area" ref="areaRef">
      <canvas ref="canvasRef" style="display:block" />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useProject } from '../composables/useProject.js'

const { project } = useProject()

const LED_RADIUS = 14   // ドット半径(px)
const LED_SPACING = 40  // LED間隔(px)
const LED_OFF = 'rgb(10,10,10)'

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

// アニメーションタイマー
let rafId = null
let lastTime = null
let accTime = 0  // フレーム間隔累積

function msPerFrame() {
  return 1000 / (fps.value * speedMultiplier.value)
}

function tick(now) {
  if (lastTime === null) lastTime = now
  const delta = now - lastTime
  lastTime = now
  accTime += delta

  while (accTime >= msPerFrame()) {
    accTime -= msPerFrame()
    advanceFrame()
  }

  draw()
  if (isPlaying.value) rafId = requestAnimationFrame(tick)
}

function advanceFrame() {
  const next = currentFrame.value + 1
  if (next >= frameCount.value) {
    if (loop.value) {
      currentFrame.value = 0
    } else {
      currentFrame.value = frameCount.value - 1
      stopPlay()
    }
  } else {
    currentFrame.value = next
  }
}

function startPlay() {
  isPlaying.value = true
  lastTime = null
  accTime = 0
  rafId = requestAnimationFrame(tick)
}

function stopPlay() {
  isPlaying.value = false
  if (rafId) { cancelAnimationFrame(rafId); rafId = null }
  draw()
}

function togglePlay() {
  if (isPlaying.value) stopPlay()
  else startPlay()
}

function stepBack() {
  currentFrame.value = Math.max(0, currentFrame.value - 1)
  draw()
}

function stepForward() {
  const next = currentFrame.value + 1
  if (next < frameCount.value) {
    currentFrame.value = next
  } else if (loop.value) {
    currentFrame.value = 0
  }
  draw()
}

// 描画
function draw() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  // 背景
  ctx.fillStyle = '#0a0a0a'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const frame = project.pattern.frames[currentFrame.value]
  if (!frame) return

  for (let i = 0; i < ledCount.value; i++) {
    const led = frame.leds[i]
    const cx = LED_SPACING + i * LED_SPACING
    const cy = canvas.height / 2

    const isOff = !led || (led.r === 0 && led.g === 0 && led.b === 0)
    const color = isOff ? LED_OFF : `rgb(${led.r},${led.g},${led.b})`

    // 点灯時はグロー効果
    if (!isOff) {
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, LED_RADIUS * 2.5)
      grad.addColorStop(0, `rgba(${led.r},${led.g},${led.b},0.6)`)
      grad.addColorStop(1, 'transparent')
      ctx.beginPath()
      ctx.arc(cx, cy, LED_RADIUS * 2.5, 0, Math.PI * 2)
      ctx.fillStyle = grad
      ctx.fill()
    }

    // LEDドット
    ctx.beginPath()
    ctx.arc(cx, cy, LED_RADIUS, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
  }
}

function updateCanvasSize() {
  const canvas = canvasRef.value
  if (!canvas || !areaRef.value) return
  const w = Math.max(ledCount.value * LED_SPACING + LED_SPACING, 200)
  const h = 80
  canvas.width = w
  canvas.height = h
  draw()
}

watch(
  [ledCount, frameCount, () => project.pattern.frames, currentFrame],
  () => {
    updateCanvasSize()
    if (!isPlaying.value) draw()
  },
  { deep: true }
)

onMounted(() => {
  updateCanvasSize()
})

onUnmounted(() => {
  stopPlay()
})
</script>

<style scoped>
.simulator-wrapper {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #0d0d0d;
  overflow: hidden;
}

.sim-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: #1e1e1e;
  border-bottom: 1px solid #333;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.sim-controls button {
  padding: 3px 10px;
  background: #333;
  color: #ddd;
  border: 1px solid #555;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
}

.sim-controls button:hover:not(:disabled) {
  background: #444;
}

.sim-controls button:disabled {
  opacity: 0.4;
  cursor: default;
}

.sim-controls label {
  font-size: 12px;
  color: #aaa;
  display: flex;
  align-items: center;
  gap: 4px;
}

.sim-controls select {
  background: #333;
  color: #ddd;
  border: 1px solid #555;
  border-radius: 3px;
  padding: 2px 4px;
  font-size: 12px;
}

.frame-info {
  font-size: 12px;
  color: #888;
  margin-left: auto;
}

.sim-canvas-area {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  padding: 16px;
}
</style>
