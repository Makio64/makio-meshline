<template>
	<section
		class="bench-diagram"
		aria-label="Interactive MeshLine V2 benchmark diagram"
	>
		<header class="bench-header">
			<div class="bench-title-group">
				<span class="bench-badge">
					<span class="bench-badge-dot" />
					Rendered with MeshLine
				</span>
				<h3 class="bench-title">
					{{ currentSuite.title }}
				</h3>
				<p class="bench-subtitle">
					{{ currentSuite.subtitle }}
				</p>
			</div>

			<div class="bench-actions">
				<button
					type="button"
					class="bench-toggle"
					:class="{ 'is-active': wireframe }"
					:aria-pressed="wireframe"
					title="Toggle MeshLine wireframe (W)"
					@click="toggleWireframe"
				>
					{{ wireframe ? 'Wireframe: ON' : 'Wireframe' }}
				</button>
				<button
					type="button"
					class="bench-toggle"
					:class="{ 'is-active': !paused }"
					:aria-pressed="!paused"
					@click="togglePaused"
				>
					{{ paused ? 'Resume' : 'Pause' }}
				</button>
			</div>
		</header>

		<nav
			class="bench-tabs"
			role="tablist"
			aria-label="Benchmark suites"
		>
			<button
				v-for="suite in suites"
				:key="suite.id"
				type="button"
				role="tab"
				class="bench-tab"
				:class="{ 'is-active': activeSuite === suite.id }"
				:aria-selected="activeSuite === suite.id"
				@click="selectSuite( suite.id )"
			>
				<span class="bench-tab-label">{{ suite.shortLabel }}</span>
				<span class="bench-tab-kpi">{{ suite.kpi }}</span>
			</button>
		</nav>

		<div class="bench-stage-wrap">
			<div
				ref="canvasHost"
				class="bench-canvas-host"
			/>

			<!-- Overlay annotations aligned with the 3D MeshLine diagram -->
			<div class="bench-overlay">
				<template v-if="activeSuite === 'partial'">
					<div
						class="bench-Callout"
						style="top: 11%; left: 5%;"
					>
						<span class="bench-dot is-coral" />
						<strong>Full <code>setPositions()</code> (200K pts)</strong>
						<span class="bench-mono">1.47 ms CPU · 28.80 MB upload</span>
					</div>
					<div
						class="bench-Callout"
						style="top: 39%; left: 5%;"
					>
						<span class="bench-dot is-emerald" />
						<strong>Partial <code>setPositionRange()</code> (128-pt brush)</strong>
						<span class="bench-mono is-highlight">0.0055 ms CPU · 18.62 KB upload (267× faster · -99.94% bytes)</span>
					</div>
					<div
						class="bench-Callout"
						style="bottom: 8%; left: 5%;"
					>
						<span class="bench-dot is-cyan" />
						<strong>Live <code>setPositionRange()</code> halo window</strong>
						<span class="bench-mono">Only the bracketed 128-point span + 1-point neighbor halo uploads per frame</span>
					</div>
				</template>

				<template v-else-if="activeSuite === 'bounds'">
					<div
						class="bench-Callout"
						style="top: 12%; left: 5%;"
					>
						<span class="bench-dot is-coral" />
						<strong>Full point rescan <code>setPositions(pts, true)</code></strong>
						<span class="bench-mono">1.70 ms (1,700 µs) · O(points)</span>
					</div>
					<div
						class="bench-Callout"
						style="top: 41%; left: 5%;"
					>
						<span class="bench-dot is-cyan" />
						<strong>Cached bounds padding · 64 lines (200K pts)</strong>
						<span class="bench-mono is-highlight">0.0057 ms (5.7 µs) · 298× faster · O(lines)</span>
					</div>
					<div
						class="bench-Callout"
						style="top: 68%; left: 5%;"
					>
						<span class="bench-dot is-emerald" />
						<strong>Cached bounds padding · 1 line (200K pts)</strong>
						<span class="bench-mono is-highlight">0.00025 ms (0.25 µs) · 6,780× faster · O(1)</span>
					</div>
					<div
						class="bench-Callout is-right"
						style="bottom: 8%; right: 4%;"
					>
						<span class="bench-dot is-emerald" />
						<strong>Live <code>lineWidth()</code> padding box</strong>
						<span class="bench-mono">Expands cached AABB/sphere without rescanning points</span>
					</div>
				</template>

				<template v-else-if="activeSuite === 'surface'">
					<div
						class="bench-Callout"
						style="top: 10%; left: 5%;"
					>
						<span class="bench-dot is-coral" />
						<strong>Fixed Round-8 Fan (before adaptive budget)</strong>
						<span class="bench-mono">549,982 verts · 18.31 MiB</span>
					</div>
					<div
						class="bench-Callout"
						style="top: 33%; left: 5%;"
					>
						<span class="bench-dot is-cyan" />
						<strong>V2 Angle-Adaptive <code>round8-butt</code> (50K pts)</strong>
						<span class="bench-mono is-highlight">199,996 verts · 6.29 MiB (-65.6% memory · 6.99 ms)</span>
					</div>
					<div
						class="bench-Callout"
						style="top: 56%; left: 5%;"
					>
						<span class="bench-dot is-amber" />
						<strong>V2 <code>bevel-butt</code> (50K pts)</strong>
						<span class="bench-mono">199,996 verts · 6.29 MiB (6.49 ms · 2.7× faster)</span>
					</div>
					<div
						class="bench-Callout"
						style="top: 78%; left: 5%;"
					>
						<span class="bench-dot is-emerald" />
						<strong>V2 Compact <code>miter-round8</code> (50K pts)</strong>
						<span class="bench-mono is-highlight">100,016 verts · 3.43 MiB (+16 cap verts · 4.42 ms · 2.6× faster)</span>
					</div>
					<div
						class="bench-Callout is-right"
						style="bottom: 8%; right: 4%;"
					>
						<span class="bench-dot is-cyan" />
						<strong>Live <code>.surface()</code> round join + cap</strong>
						<span class="bench-mono">Toggle Wireframe above to inspect the triangle fan</span>
					</div>
				</template>

				<template v-else-if="activeSuite === 'scaling'">
					<div
						class="bench-Callout"
						style="top: 10%; left: 5%;"
					>
						<span class="bench-dot is-emerald" />
						<strong>Screen <code>setPositions()</code></strong>
						<span class="bench-mono">1K: 0.009 ms → 10K: 0.067 ms → 50K: 0.35 ms → 200K: 1.45 ms</span>
					</div>
					<div
						class="bench-Callout"
						style="top: 26%; left: 5%;"
					>
						<span class="bench-dot is-amber" />
						<strong>Screen <code>new MeshLineGeometry()</code> build</strong>
						<span class="bench-mono">1K: 0.053 ms → 10K: 0.24 ms → 50K: 1.20 ms → 200K: 4.05 ms</span>
					</div>
					<div
						class="bench-Callout"
						style="top: 42%; left: 5%;"
					>
						<span class="bench-dot is-violet" />
						<strong>Surface <code>setPositions()</code> (transport + distance UVs)</strong>
						<span class="bench-mono">1K: 0.15 ms → 10K: 0.88 ms → 50K: 4.44 ms (in-place buffer & index reuse)</span>
					</div>
					<div class="bench-x-axis">
						<span>1,000 pts</span>
						<span>10,000 pts</span>
						<span>50,000 pts</span>
						<span>200,000 pts</span>
					</div>
				</template>
			</div>
		</div>

		<footer class="bench-kpis">
			<div
				v-for="card in currentSuite.cards"
				:key="card.label"
				class="bench-kpi-card"
			>
				<span class="bench-kpi-value">{{ card.value }}</span>
				<span class="bench-kpi-label">{{ card.label }}</span>
				<span class="bench-kpi-detail">{{ card.detail }}</span>
			</div>
		</footer>
	</section>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'

const suites = [
	{
		id: 'partial',
		shortLabel: 'Partial Range Upload',
		kpi: '267× faster',
		title: 'Partial Range Edits vs Full Buffer Upload (200,000 Points)',
		subtitle: 'setPositionRange() updates only the edited slice plus its 1-point neighbor halo instead of re-uploading all 800,000 billboard vertices.',
		cards: [
			{ value: '267×', label: 'Faster CPU update', detail: '0.0055 ms vs 1.47 ms on 200K points' },
			{ value: '-99.94%', label: 'Less GPU upload traffic', detail: '18.6 KB halo range vs 28.8 MB full attributes' },
			{ value: '128 pts', label: 'Brush edit window', detail: 'Updates position, previous & next in-place' },
			{ value: 'pnpm bench:hotpaths', label: 'Reproducible script', detail: 'benchmarks/meshline-geometry-hotpaths.mjs' },
		],
	},
	{
		id: 'bounds',
		shortLabel: 'O(lines) Bounds Refresh',
		kpi: '6,780× faster',
		title: 'Cached Unpadded Bounds Refresh (O(lines) vs O(points))',
		subtitle: 'MeshLineGeometry caches each line’s unpadded AABB and sphere so animating lineWidth(), miterLimit(), or sizeAttenuation() never rescans points.',
		cards: [
			{ value: '6,780×', label: 'Single 200K-point line', detail: '0.25 µs cached padding vs 1.70 ms point scan' },
			{ value: '298×', label: '64 lines (200K points)', detail: '5.7 µs O(lines) refresh vs 1.69 ms rescan' },
			{ value: '0 allocs', label: 'Per-frame width animation', detail: 'Recomputes world padding in microseconds' },
			{ value: 'pnpm bench:bounds', label: 'Reproducible script', detail: 'benchmarks/meshline-bounds-refresh.mjs' },
		],
	},
	{
		id: 'surface',
		shortLabel: 'Surface Topology',
		kpi: '2.7× faster · -65.6% RAM',
		title: 'Angle-Adaptive Surface Topology & Scratch-Pool Frame Builds (50,000 Points)',
		subtitle: 'World-space ribbons compute join frames once in a flat scratch pool (2.5×–2.7× faster), skip canonical index rewrites, and scale round join subdivisions by turn angle.',
		cards: [
			{ value: '-65.6%', label: 'Round-8 buffer memory', detail: '6.29 MiB (199,996 verts) vs 18.31 MiB (549,982 verts)' },
			{ value: '2.5×–2.7×', label: 'Faster surface builds', detail: '4.24 ms miter/butt · 6.49 ms bevel · 6.99 ms round-8' },
			{ value: '+16 verts', label: 'Miter + Round-8 cap overhead', detail: '100,016 vertices vs 100,000 for miter/butt' },
			{ value: 'pnpm bench:surface-topology', label: 'Reproducible script', detail: 'benchmarks/surface-variable-topology.mjs' },
		],
	},
	{
		id: 'scaling',
		shortLabel: 'Scaling (1K–200K)',
		kpi: 'Linear O(N)',
		title: 'Linear O(N) CPU Geometry Scaling from 1,000 to 200,000 Points',
		subtitle: 'Tight typed-array passes, non-allocating hypot3(), and in-place attribute & index reuse keep screen and surface updates linear across two orders of magnitude.',
		cards: [
			{ value: '0.067 ms', label: '10K screen setPositions()', detail: '0.24 ms initial build · 1.88 MB buffers' },
			{ value: '1.45 ms', label: '200K screen setPositions()', detail: '4.05 ms initial build · 40.0 MB buffers' },
			{ value: '0.88 ms', label: '10K surface setPositions()', detail: 'Reuses position, normal & index buffers in place' },
			{ value: 'pnpm bench:v2', label: 'Reproducible script', detail: 'benchmarks/v2-geometry.mjs' },
		],
	},
]

const activeSuite = ref( 'partial' )
const wireframe = ref( false )
const paused = ref( false )
const canvasHost = ref( null )

const currentSuite = computed( () => suites.find( suite => suite.id === activeSuite.value ) || suites[0] )

let rebuildDiagramScene = null
let applyWireframeState = null
let syncRunState = null
let cleanupThree = () => {}

function selectSuite( id ) {
	if ( activeSuite.value === id ) return
	activeSuite.value = id
	rebuildDiagramScene?.()
}

function toggleWireframe() {
	wireframe.value = !wireframe.value
	applyWireframeState?.( wireframe.value )
}

function togglePaused() {
	paused.value = !paused.value
	syncRunState?.()
}

onUnmounted( () => {
	cleanupThree()
} )

onMounted( async () => {
	const host = canvasHost.value
	if ( !host ) return

	let disposed = false
	let animationId = null
	let renderer = null
	let scene = null
	let camera = null
	let resizeObserver = null
	let activeLines = []
	let animatedWave = null
	let animatedWavePoints = null
	let animatedPatch = null
	let animatedPulseLines = []
	let animatedBoundsLine = null
	let animatedBoundsBox = null
	let startTime = performance.now()

	const clearActiveLines = () => {
		for ( const line of activeLines ) {
			scene?.remove( line )
			line.dispose()
		}
		activeLines = []
		animatedWave = null
		animatedWavePoints = null
		animatedPatch = null
		animatedPulseLines = []
		animatedBoundsLine = null
		animatedBoundsBox = null
	}

	cleanupThree = () => {
		disposed = true
		if ( animationId !== null ) {
			cancelAnimationFrame( animationId )
			animationId = null
		}
		resizeObserver?.disconnect()
		window.removeEventListener( 'keydown', onKeyDown )
		clearActiveLines()
		if ( renderer ) {
			renderer.dispose()
			renderer.domElement?.remove()
			renderer = null
		}
		scene = null
		camera = null
	}

	const onKeyDown = event => {
		if ( event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey ) return
		const tag = event.target?.tagName
		if ( tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target?.isContentEditable ) return
		if ( event.key === 'w' || event.key === 'W' ) {
			toggleWireframe()
		}
	}

	try {
		const [THREE, { MeshLine, circlePositions, rectanglePositions, straightLineBetween }] = await Promise.all( [
			import( 'three/webgpu' ),
			import( 'makio-meshline' ),
		] )
		if ( disposed ) return

		const getBounds = () => {
			const rect = host.getBoundingClientRect()
			return {
				width: Math.max( 1, Math.round( rect.width || 800 ) ),
				height: Math.max( 1, Math.round( rect.height || 340 ) ),
			}
		}

		const initialSize = getBounds()
		renderer = new THREE.WebGPURenderer( { antialias: true, alpha: true } )
		renderer.setPixelRatio( Math.min( window.devicePixelRatio || 1, 2 ) )
		renderer.setSize( initialSize.width, initialSize.height )
		renderer.setClearColor( 0x000000, 0 )
		await renderer.init()
		if ( disposed ) {
			cleanupThree()
			return
		}
		host.appendChild( renderer.domElement )

		scene = new THREE.Scene()
		camera = new THREE.PerspectiveCamera( 34, initialSize.width / initialSize.height, 0.1, 100 )
		camera.position.set( 0, 0, 12.2 )

		const registerLine = line => {
			line.wireframe( wireframe.value )
			scene.add( line )
			activeLines.push( line )
			return line
		}

		const addBackgroundGrid = ( { width, height } ) => {
			const gridSegments = []
			for ( let y = -3; y <= 3; y += 1.5 ) {
				gridSegments.push( straightLineBetween( [-6.2, y, -0.2], [6.2, y, -0.2], 2 ) )
			}
			for ( let x = -4.8; x <= 4.8; x += 3.2 ) {
				gridSegments.push( straightLineBetween( [x, -3.2, -0.2], [x, 3.2, -0.2], 2 ) )
			}
			const grid = new MeshLine()
				.lines( gridSegments, false )
				.lineWidth( 0.025 )
				.color( 0x64748b )
				.opacity( 0.2 )
				.dash( { count: 28, ratio: 0.45 } )
				.renderSize( width, height )
				.build()
			registerLine( grid )
		}

		const createBar = ( x0, x1, y, lineWidth, colorHex, gradHex, size, extra = {} ) => {
			const pts = straightLineBetween( [x0, y, 0], [x1, y, 0], 24 )
			const bar = new MeshLine()
				.lines( pts, false )
				.lineWidth( lineWidth )
				.color( colorHex )
				.gradientColor( gradHex )
				.join( { type: 'round', segments: 6 } )
				.renderSize( size.width, size.height )
			if ( extra.opacity !== undefined ) bar.opacity( extra.opacity )
			if ( extra.dash ) bar.dash( extra.dash )
			return registerLine( bar.build() )
		}

		const buildPartialScene = size => {
			// 1. Full 200K upload bar (28.8 MB / 1.47 ms)
			createBar( -5.5, 5.5, 1.35, 0.34, 0xff5e3a, 0xff9f43, size, { opacity: 0.88 } )
			const fullPulse = createBar( -5.5, 5.5, 1.35, 0.14, 0xffffff, 0xffd166, size, {
				opacity: 0.65,
				dash: { count: 14, ratio: 0.35, offset: 0 },
			} )
			animatedPulseLines.push( { line: fullPulse, speed: -0.45 } )

			// 2. Partial setPositionRange track (18.6 KB / 0.0055 ms)
			createBar( -5.5, 5.5, -0.05, 0.24, 0x334155, 0x475569, size, { opacity: 0.35 } )
			const haloBar = createBar( -5.5, -4.65, -0.05, 0.38, 0x00f5d4, 0x38ef7d, size )
			const haloPulse = createBar( -5.5, -4.65, -0.05, 0.16, 0xffffff, 0xa7f3d0, size, {
				dash: { count: 4, ratio: 0.45, offset: 0 },
			} )
			animatedPulseLines.push( { line: haloBar, speed: 0 } )
			animatedPulseLines.push( { line: haloPulse, speed: -2.4 } )

			// 3. Live wave path edited via setPositionRange() every frame
			const pointCount = 160
			const wavePoints = new Float32Array( pointCount * 3 )
			for ( let i = 0; i < pointCount; i++ ) {
				const t = i / ( pointCount - 1 )
				wavePoints[i * 3] = -5.5 + t * 11.0
				wavePoints[i * 3 + 1] = -1.75 + Math.sin( t * Math.PI * 6 ) * 0.22
				wavePoints[i * 3 + 2] = 0
			}
			animatedWavePoints = wavePoints
			animatedPatch = new Float32Array( 28 * 3 )

			animatedWave = registerLine(
				new MeshLine()
					.lines( wavePoints, false )
					.dynamic( true )
					.lineWidth( 0.11 )
					.color( 0x38bdf8 )
					.gradientColor( 0x34d399 )
					.renderSize( size.width, size.height )
					.build()
			)

			// Bracket rings around the partial update range [66..93]
			for ( const bracketIndex of [66, 93] ) {
				const bx = wavePoints[bracketIndex * 3]
				const ringPts = circlePositions( 28, 0.34 )
				for ( let i = 0; i < ringPts.length; i += 3 ) {
					ringPts[i] += bx
					ringPts[i + 1] += -1.75
					ringPts[i + 2] += 0.05
				}
				const ring = registerLine(
					new MeshLine()
						.lines( ringPts, true )
						.lineWidth( 0.055 )
						.color( 0x00f5d4 )
						.dash( { count: 6, ratio: 0.5, offset: 0 } )
						.renderSize( size.width, size.height )
						.build()
				)
				animatedPulseLines.push( { line: ring, speed: 0.6 } )
			}
		}

		const buildBoundsScene = size => {
			// Bar 1: Full point scan setPositions(pts, true) = 1.70 ms
			createBar( -5.5, 1.3, 1.35, 0.32, 0xff5e3a, 0xff9f43, size, { opacity: 0.9 } )
			// Bar 2: Cached bounds padding 64 lines = 0.0057 ms (log-scaled bar)
			createBar( -5.5, 1.3, 0.0, 0.22, 0x334155, 0x475569, size, { opacity: 0.3 } )
			const bar64 = createBar( -5.5, -4.1, 0.0, 0.34, 0x38bdf8, 0x00f5d4, size )
			animatedPulseLines.push( { line: bar64, speed: 0 } )

			// Bar 3: Cached bounds padding 1 line = 0.00025 ms (0.25 µs)
			createBar( -5.5, 1.3, -1.35, 0.22, 0x334155, 0x475569, size, { opacity: 0.3 } )
			createBar( -5.5, -4.95, -1.35, 0.38, 0x34d399, 0xa7f3d0, size )

			// Right side: Live curve with pulsing lineWidth() + O(1) padded bounding box in MeshLine
			const curveCount = 72
			const curvePts = new Float32Array( curveCount * 3 )
			for ( let i = 0; i < curveCount; i++ ) {
				const t = i / ( curveCount - 1 )
				const angle = t * Math.PI * 2.5
				curvePts[i * 3] = 3.85 + Math.cos( angle ) * ( 0.55 + t * 0.75 )
				curvePts[i * 3 + 1] = -0.95 + t * 2.1 + Math.sin( angle * 1.5 ) * 0.25
				curvePts[i * 3 + 2] = 0
			}
			animatedBoundsLine = registerLine(
				new MeshLine()
					.lines( curvePts, false )
					.lineWidth( 0.18 )
					.color( 0x00f5d4 )
					.gradientColor( 0x38bdf8 )
					.renderSize( size.width, size.height )
					.build()
			)

			const boxPts = rectanglePositions( 3.1, 2.9, 32 )
			for ( let i = 0; i < boxPts.length; i += 3 ) {
				boxPts[i] += 3.85
				boxPts[i + 1] += 0.1
			}
			animatedBoundsBox = registerLine(
				new MeshLine()
					.lines( boxPts, true )
					.dynamic( true )
					.lineWidth( 0.055 )
					.color( 0x34d399 )
					.dash( { count: 20, ratio: 0.55, offset: 0 } )
					.renderSize( size.width, size.height )
					.build()
			)
			animatedPulseLines.push( { line: animatedBoundsBox, speed: -0.4 } )
		}

		const buildSurfaceScene = size => {
			// 4 Memory / Topology Bars (50K points)
			// 1. Fixed Round-8: 18.31 MiB (full width -5.5 -> +1.2, span 6.7)
			createBar( -5.5, 1.2, 1.55, 0.28, 0xff5e3a, 0xff9f43, size, { opacity: 0.88 } )
			// 2. V2 Adaptive Round-8: 6.29 MiB (-65.6% -> span 2.30)
			createBar( -5.5, 1.2, 0.45, 0.18, 0x334155, 0x475569, size, { opacity: 0.28 } )
			createBar( -5.5, -3.2, 0.45, 0.3, 0x00f5d4, 0x38bdf8, size )
			// 3. V2 Bevel-Butt: 6.29 MiB (span 2.30)
			createBar( -5.5, 1.2, -0.65, 0.18, 0x334155, 0x475569, size, { opacity: 0.28 } )
			createBar( -5.5, -3.2, -0.65, 0.3, 0xfbbf24, 0xf59e0b, size )
			// 4. V2 Compact Miter + Round-8 Cap: 3.43 MiB (span 1.25)
			createBar( -5.5, 1.2, -1.75, 0.18, 0x334155, 0x475569, size, { opacity: 0.28 } )
			createBar( -5.5, -4.25, -1.75, 0.32, 0x34d399, 0xa7f3d0, size )

			// Right side: Live .surface() ribbon with angle-adaptive round joins & round caps
			const roadCornerPts = new Float32Array( [
				2.35, -1.55, 0,
				2.85, 1.35, 0,
				4.15, -1.15, 0,
				5.35, 1.45, 0,
			] )
			registerLine(
				new MeshLine()
					.lines( roadCornerPts, false )
					.lineWidth( 0.62 )
					.color( 0x38bdf8 )
					.gradientColor( 0x34d399 )
					.surface( {
						frame: 'fixed-up',
						up: [0, 0, 1],
						uvMode: 'distance',
						uvScale: 2,
						roughness: 0.4,
						metalness: 0.1,
					} )
					.join( { type: 'round', limit: 3, segments: 8 } )
					.cap( { type: 'round', segments: 8 } )
					.build()
			)
		}

		const buildScalingScene = size => {
			const xStops = [-4.8, -1.6, 1.6, 4.8]
			// Map ms in [0.008 .. 7.0] on a readable log-inspired vertical axis [-2.2 .. +2.1]
			const mapY = ms => {
				const minLog = Math.log10( 0.008 )
				const maxLog = Math.log10( 7.5 )
				const t = ( Math.log10( Math.max( 0.008, ms ) ) - minLog ) / ( maxLog - minLog )
				return -2.1 + t * 4.1
			}

			const sampleCurve = ( xs, ys ) => {
				const segments = 64
				const out = new Float32Array( ( segments + 1 ) * 3 )
				for ( let i = 0; i <= segments; i++ ) {
					const u = ( i / segments ) * ( xs.length - 1 )
					const idx = Math.min( xs.length - 2, Math.floor( u ) )
					const f = u - idx
					const smooth = f * f * ( 3 - 2 * f )
					out[i * 3] = xs[idx] + ( xs[idx + 1] - xs[idx] ) * f
					out[i * 3 + 1] = ys[idx] + ( ys[idx + 1] - ys[idx] ) * smooth
					out[i * 3 + 2] = 0
				}
				return out
			}

			const series = [
				{
					xs: xStops,
					ys: [0.0093, 0.0672, 0.3453, 1.4499].map( mapY ),
					color: 0x34d399,
					grad: 0x00f5d4,
					width: 0.13,
				},
				{
					xs: xStops,
					ys: [0.0116, 0.0839, 0.3935, 1.7142].map( mapY ),
					color: 0x38bdf8,
					grad: 0x60a5fa,
					width: 0.09,
					dash: { count: 22, ratio: 0.5, offset: 0 },
				},
				{
					xs: xStops,
					ys: [0.0531, 0.2408, 1.1986, 4.0456].map( mapY ),
					color: 0xfbbf24,
					grad: 0xff5e3a,
					width: 0.12,
				},
				{
					xs: xStops.slice( 0, 3 ),
					ys: [0.1511, 0.8845, 4.4359].map( mapY ),
					color: 0xa78bfa,
					grad: 0xf472b6,
					width: 0.12,
				},
			]

			for ( const item of series ) {
				const curvePts = sampleCurve( item.xs, item.ys )
				const line = new MeshLine()
					.lines( curvePts, false )
					.lineWidth( item.width )
					.color( item.color )
					.gradientColor( item.grad )
					.join( { type: 'round', segments: 6 } )
					.renderSize( size.width, size.height )
				if ( item.dash ) line.dash( item.dash )
				const built = registerLine( line.build() )
				if ( item.dash ) animatedPulseLines.push( { line: built, speed: -0.35 } )

				// Data-point rings in MeshLine
				const nodeRings = []
				for ( let i = 0; i < item.xs.length; i++ ) {
					const ring = circlePositions( 20, 0.14 )
					for ( let k = 0; k < ring.length; k += 3 ) {
						ring[k] += item.xs[i]
						ring[k + 1] += item.ys[i]
						ring[k + 2] += 0.04
					}
					nodeRings.push( ring )
				}
				registerLine(
					new MeshLine()
						.lines( nodeRings, true )
						.lineWidth( 0.045 )
						.color( item.color )
						.renderSize( size.width, size.height )
						.build()
				)
			}
		}

		rebuildDiagramScene = () => {
			if ( !scene || !renderer ) return
			clearActiveLines()
			const size = getBounds()
			addBackgroundGrid( size )
			if ( activeSuite.value === 'partial' ) buildPartialScene( size )
			else if ( activeSuite.value === 'bounds' ) buildBoundsScene( size )
			else if ( activeSuite.value === 'surface' ) buildSurfaceScene( size )
			else buildScalingScene( size )
			renderer.render( scene, camera )
		}

		applyWireframeState = enabled => {
			for ( const line of activeLines ) {
				line.wireframe( enabled )
			}
			if ( renderer && scene && camera ) renderer.render( scene, camera )
		}

		const tick = now => {
			animationId = null
			if ( disposed || paused.value ) return
			const elapsed = ( now - startTime ) * 0.001

			for ( const entry of animatedPulseLines ) {
				if ( entry.speed !== 0 && entry.line.material?.dashOffset ) {
					entry.line.material.dashOffset.value = elapsed * entry.speed
				}
			}

			// Live setPositionRange() update on the 160-point wave in 'partial' mode
			if ( animatedWave && animatedWavePoints && animatedPatch ) {
				const startIdx = 66
				const count = 28
				for ( let i = 0; i < count; i++ ) {
					const pointIndex = startIdx + i
					const t = pointIndex / 159
					const local = i / ( count - 1 )
					const envelope = Math.sin( local * Math.PI )
					animatedPatch[i * 3] = -5.5 + t * 11.0
					animatedPatch[i * 3 + 1] = -1.75
						+ Math.sin( t * Math.PI * 6 ) * 0.22
						+ Math.sin( elapsed * 5.2 + local * Math.PI * 3 ) * 0.42 * envelope
					animatedPatch[i * 3 + 2] = 0
				}
				animatedWave.setPositionRange( animatedPatch, startIdx )
			}

			// Live lineWidth() + padded bounding box update in 'bounds' mode
			if ( animatedBoundsLine && animatedBoundsBox ) {
				const pulse = 0.5 + 0.5 * Math.sin( elapsed * 3.2 )
				const width = 0.08 + pulse * 0.28
				animatedBoundsLine.lineWidth( width )
				const pad = width * 0.85
				const boxPts = rectanglePositions( 2.85 + pad, 2.65 + pad, 32 )
				for ( let i = 0; i < boxPts.length; i += 3 ) {
					boxPts[i] += 3.85
					boxPts[i + 1] += 0.1
				}
				animatedBoundsBox.setPositions( boxPts, false )
			}

			renderer.render( scene, camera )
			animationId = requestAnimationFrame( tick )
		}

		syncRunState = () => {
			if ( paused.value ) {
				if ( animationId !== null ) {
					cancelAnimationFrame( animationId )
					animationId = null
				}
			} else if ( animationId === null && !disposed ) {
				animationId = requestAnimationFrame( tick )
			}
		}

		const handleResize = () => {
			if ( !renderer || !camera ) return
			const size = getBounds()
			camera.aspect = size.width / size.height
			camera.updateProjectionMatrix()
			renderer.setSize( size.width, size.height )
			for ( const line of activeLines ) {
				line.resize( size.width, size.height )
			}
			renderer.render( scene, camera )
		}

		resizeObserver = new ResizeObserver( handleResize )
		resizeObserver.observe( host )
		window.addEventListener( 'keydown', onKeyDown )

		rebuildDiagramScene()
		if ( window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches ) {
			paused.value = true
		} else {
			syncRunState()
		}
	} catch ( error ) {
		console.warn( 'BenchmarkDiagram WebGPU/WebGL2 preview skipped:', error )
	}
} )
</script>

<style scoped>
.bench-diagram {
	margin: 1.75rem 0 2.25rem;
	border-radius: 14px;
	border: 1px solid var(--vp-c-divider);
	background: linear-gradient(180deg, rgba(15, 23, 42, 0.78) 0%, rgba(9, 13, 24, 0.92) 100%);
	overflow: hidden;
	box-shadow: 0 16px 40px rgba(0, 0, 0, 0.24);
}

:root:not(.dark) .bench-diagram {
	background: linear-gradient(180deg, rgba(15, 23, 42, 0.94) 0%, rgba(15, 23, 42, 0.98) 100%);
	color: #f8fafc;
}

.bench-header {
	display: flex;
	flex-wrap: wrap;
	align-items: flex-start;
	justify-content: space-between;
	gap: 1rem;
	padding: 1.15rem 1.35rem 0.85rem;
	border-bottom: 1px solid rgba(148, 163, 184, 0.14);
}

.bench-title-group {
	flex: 1 1 360px;
}

.bench-badge {
	display: inline-flex;
	align-items: center;
	gap: 0.42rem;
	padding: 0.18rem 0.6rem;
	border-radius: 999px;
	font-size: 0.72rem;
	font-weight: 600;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: #34d399;
	background: rgba(16, 185, 129, 0.12);
	border: 1px solid rgba(52, 211, 153, 0.3);
}

.bench-badge-dot {
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: #34d399;
	box-shadow: 0 0 8px #34d399;
}

.bench-title {
	margin: 0.45rem 0 0.2rem !important;
	font-size: 1.12rem !important;
	line-height: 1.35 !important;
	font-weight: 650 !important;
	color: #f8fafc !important;
	border: none !important;
	padding: 0 !important;
}

.bench-subtitle {
	margin: 0 !important;
	font-size: 0.85rem;
	line-height: 1.45;
	color: rgba(226, 232, 240, 0.74);
}

.bench-actions {
	display: flex;
	align-items: center;
	gap: 0.45rem;
}

.bench-toggle {
	padding: 0.34rem 0.72rem;
	border-radius: 8px;
	font-size: 0.76rem;
	font-weight: 600;
	font-family: var(--vp-font-family-mono);
	color: #cbd5e1;
	background: rgba(30, 41, 59, 0.75);
	border: 1px solid rgba(148, 163, 184, 0.24);
	cursor: pointer;
	transition: all 0.16s ease;
}

.bench-toggle:hover {
	color: #ffffff;
	border-color: rgba(56, 189, 248, 0.55);
}

.bench-toggle.is-active {
	color: #0f172a;
	background: #38bdf8;
	border-color: #38bdf8;
}

.bench-tabs {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	gap: 0.45rem;
	padding: 0.65rem 1.35rem;
	background: rgba(2, 6, 23, 0.42);
	border-bottom: 1px solid rgba(148, 163, 184, 0.14);
}

.bench-tab {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 0.12rem;
	padding: 0.52rem 0.75rem;
	border-radius: 9px;
	text-align: left;
	background: rgba(30, 41, 59, 0.42);
	border: 1px solid rgba(148, 163, 184, 0.16);
	color: #cbd5e1;
	cursor: pointer;
	transition: all 0.16s ease;
}

.bench-tab:hover {
	background: rgba(30, 41, 59, 0.78);
	border-color: rgba(56, 189, 248, 0.4);
}

.bench-tab.is-active {
	background: rgba(14, 116, 144, 0.28);
	border-color: #00f5d4;
	box-shadow: inset 0 0 0 1px rgba(0, 245, 212, 0.25);
}

.bench-tab-label {
	font-size: 0.78rem;
	font-weight: 600;
	color: #f1f5f9;
}

.bench-tab-kpi {
	font-size: 0.72rem;
	font-family: var(--vp-font-family-mono);
	color: #34d399;
}

.bench-stage-wrap {
	position: relative;
	width: 100%;
	height: 320px;
	background: radial-gradient(circle at 50% 50%, rgba(14, 165, 233, 0.08) 0%, rgba(2, 6, 23, 0.65) 100%);
}

.bench-canvas-host {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
}

.bench-canvas-host :deep(canvas) {
	display: block;
	width: 100% !important;
	height: 100% !important;
}

.bench-overlay {
	position: absolute;
	inset: 0;
	pointer-events: none;
}

.bench-Callout {
	position: absolute;
	display: inline-flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.42rem;
	padding: 0.24rem 0.58rem;
	border-radius: 7px;
	font-size: 0.75rem;
	line-height: 1.3;
	color: #e2e8f0;
	background: rgba(2, 6, 23, 0.74);
	border: 1px solid rgba(148, 163, 184, 0.2);
	backdrop-filter: blur(6px);
	max-width: 90%;
}

.bench-Callout.is-right {
	text-align: right;
}

.bench-Callout code {
	font-size: 0.72rem;
	padding: 0.05rem 0.28rem;
	border-radius: 4px;
	background: rgba(56, 189, 248, 0.14);
	color: #7dd3fc;
}

.bench-mono {
	font-family: var(--vp-font-family-mono);
	font-size: 0.72rem;
	color: #94a3b8;
}

.bench-mono.is-highlight {
	color: #34d399;
	font-weight: 600;
}

.bench-dot {
	width: 8px;
	height: 8px;
	border-radius: 50%;
	flex-shrink: 0;
}

.bench-dot.is-coral { background: #ff5e3a; box-shadow: 0 0 8px #ff5e3a; }
.bench-dot.is-emerald { background: #34d399; box-shadow: 0 0 8px #34d399; }
.bench-dot.is-cyan { background: #00f5d4; box-shadow: 0 0 8px #00f5d4; }
.bench-dot.is-amber { background: #fbbf24; box-shadow: 0 0 8px #fbbf24; }
.bench-dot.is-violet { background: #a78bfa; box-shadow: 0 0 8px #a78bfa; }

.bench-x-axis {
	position: absolute;
	bottom: 8px;
	left: 14%;
	right: 14%;
	display: flex;
	justify-content: space-between;
	font-family: var(--vp-font-family-mono);
	font-size: 0.72rem;
	color: #94a3b8;
}

.bench-kpis {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	gap: 0.65rem;
	padding: 0.9rem 1.35rem 1.1rem;
	border-top: 1px solid rgba(148, 163, 184, 0.14);
	background: rgba(2, 6, 23, 0.5);
}

.bench-kpi-card {
	display: flex;
	flex-direction: column;
	gap: 0.14rem;
	padding: 0.6rem 0.75rem;
	border-radius: 9px;
	background: rgba(15, 23, 42, 0.65);
	border: 1px solid rgba(148, 163, 184, 0.14);
}

.bench-kpi-value {
	font-family: var(--vp-font-family-mono);
	font-size: 1.05rem;
	font-weight: 700;
	color: #00f5d4;
}

.bench-kpi-label {
	font-size: 0.78rem;
	font-weight: 600;
	color: #f1f5f9;
}

.bench-kpi-detail {
	font-size: 0.71rem;
	color: #94a3b8;
	line-height: 1.35;
}

@media (max-width: 860px) {
	.bench-tabs,
	.bench-kpis {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	.bench-stage-wrap {
		height: 360px;
	}
}
</style>
