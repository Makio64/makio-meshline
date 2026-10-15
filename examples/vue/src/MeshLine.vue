<script setup>
import { MeshLine as MeshLineCore } from 'makio-meshline'
import { BufferGeometry } from 'three/webgpu'
import { inject, onMounted, onUnmounted, shallowRef, unref, watch } from 'vue'

const DEFAULT_JOIN = Object.freeze( { type: 'miter', limit: 4, segments: 8 } )
const DEFAULT_CAP = Object.freeze( { type: 'butt', segments: 8 } )

const props = defineProps( {
	// Scene and geometry
	parent: { type: Object, default: null },
	points: { type: [Array, Float32Array, BufferGeometry], default: null },
	lines: { type: [Array, Float32Array, BufferGeometry], default: null },
	segments: { type: Number, default: undefined },
	closed: { type: [Boolean, Array], default: false },
	surface: { type: [Boolean, Object], default: false },
	join: { type: Object, default: null },
	cap: { type: [String, Object], default: null },
	smoothSharpBends: { type: Boolean, default: false },
	smoothSharpBendsAlpha: { type: Number, default: undefined },
	smoothSharpBendsThreshold: { type: Number, default: undefined },
	updateBounding: { type: Boolean, default: false },

	// Appearance
	lineWidth: { type: Number, default: 0.3 },
	color: { type: [Number, String, Object], default: 0xffffff },
	vertexColors: { type: [Array, Float32Array], default: null },
	widthCallback: { type: Function, default: null },
	gradientColor: { type: [Number, String, Object], default: null },
	dash: { type: Object, default: null },
	map: { type: Object, default: null },
	mapOffset: { type: Object, default: null },
	alphaMap: { type: Object, default: null },
	opacity: { type: Number, default: 1 },
	alphaTest: { type: Number, default: 0 },
	transparent: { type: Boolean, default: false },
	wireframe: { type: Boolean, default: false },
	shadow: { type: Boolean, default: false },
	sizeAttenuation: { type: Boolean, default: true },

	// Renderer and buffers
	dpr: { type: Number, default: undefined },
	frustumCulled: { type: Boolean, default: undefined },
	verbose: { type: Boolean, default: false },
	renderWidth: { type: Number, default: undefined },
	renderHeight: { type: Number, default: undefined },
	dynamic: { type: Boolean, default: undefined },
	gpuPositionNode: { type: Function, default: null },
	usage: { type: Number, default: undefined },
	instanceCount: { type: Number, default: undefined },
	needsUV: { type: Boolean, default: undefined },
	needsWidth: { type: Boolean, default: undefined },
	needsProgress: { type: Boolean, default: undefined },
	needsPrevious: { type: Boolean, default: undefined },
	needsNext: { type: Boolean, default: undefined },
	needsSide: { type: Boolean, default: undefined },
	needsVertexColor: { type: Boolean, default: undefined },

	// TSL hooks
	widthFn: { type: Function, default: null },
	normalFn: { type: Function, default: null },
	colorFn: { type: Function, default: null },
	opacityFn: { type: Function, default: null },
	gradientFn: { type: Function, default: null },
	uvFn: { type: Function, default: null },
	dashFn: { type: Function, default: null },
	positionFn: { type: Function, default: null },
	previousFn: { type: Function, default: null },
	nextFn: { type: Function, default: null },
	fragmentColorFn: { type: Function, default: null },
	fragmentAlphaFn: { type: Function, default: null },
	discardFn: { type: Function, default: null },
	vertexFn: { type: Function, default: null },
} )

const emit = defineEmits( ['ready'] )
const lineRef = shallowRef( null )
const injectedParent = inject( 'meshline-parent', null )
let mounted = false
let previousClosed = props.closed
let hadLinePoints = resolveLines() != null

function resolveParent() {
	return unref( props.parent ) || unref( injectedParent )
}

function resolveLines() {
	return props.points ?? props.lines
}

function defaultDpr() {
	return typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
}

function defaultRenderWidth() {
	return typeof window === 'undefined' ? 1024 : window.innerWidth
}

function defaultRenderHeight() {
	return typeof window === 'undefined' ? 768 : window.innerHeight
}

// A window can measure 0×0 (an iframe before layout, a hidden tab), and
// renderSize() rejects a zero size, so clamp to one pixel as resize() does.
function resolveRenderWidth() {
	return Math.max( 1, props.renderWidth ?? defaultRenderWidth() )
}

function resolveRenderHeight() {
	return Math.max( 1, props.renderHeight ?? defaultRenderHeight() )
}

function resolveFrustumCulled() {
	if ( props.frustumCulled !== undefined ) return props.frustumCulled
	return props.sizeAttenuation !== false &&
		!props.gpuPositionNode &&
		!props.positionFn &&
		!props.previousFn &&
		!props.nextFn &&
		!props.widthFn &&
		!props.normalFn &&
		!props.vertexFn
}

function getBuildOptions() {
	return {
		lines: resolveLines(),
		segments: props.segments ?? 1,
		closed: props.closed,
		surface: props.surface,
		join: props.join ?? DEFAULT_JOIN,
		cap: props.cap ?? DEFAULT_CAP,
		smoothSharpBends: props.smoothSharpBends,
		smoothSharpBendsAlpha: props.smoothSharpBendsAlpha ?? 0.001,
		smoothSharpBendsThreshold: props.smoothSharpBendsThreshold ?? -0.5,
		vertexColors: props.vertexColors,
		color: props.color,
		lineWidth: props.lineWidth,
		widthCallback: props.widthCallback,
		sizeAttenuation: props.sizeAttenuation,
		gradientColor: props.gradientColor,
		map: props.map,
		mapOffset: props.mapOffset,
		alphaMap: props.alphaMap,
		opacity: props.opacity,
		alphaTest: props.alphaTest,
		transparent: props.transparent || props.opacity < 1,
		wireframe: props.wireframe,
		shadow: props.shadow,
		dpr: props.dpr ?? defaultDpr(),
		frustumCulled: resolveFrustumCulled(),
		verbose: props.verbose,
		renderWidth: resolveRenderWidth(),
		renderHeight: resolveRenderHeight(),
		dynamic: props.dynamic ?? false,
		gpuPositionNode: props.gpuPositionNode,
		usage: props.usage,
		instanceCount: props.instanceCount ?? -1,
		needsUV: props.needsUV ?? false,
		needsWidth: props.needsWidth ?? false,
		needsProgress: props.needsProgress ?? false,
		needsPrevious: props.needsPrevious ?? !props.gpuPositionNode,
		needsNext: props.needsNext ?? !props.gpuPositionNode,
		needsSide: props.needsSide ?? false,
		needsVertexColor: props.needsVertexColor ?? false,
		positionFn: props.positionFn,
		previousFn: props.previousFn,
		nextFn: props.nextFn,
		widthFn: props.widthFn,
		normalFn: props.normalFn,
		colorFn: props.colorFn,
		gradientFn: props.gradientFn,
		opacityFn: props.opacityFn,
		dashFn: props.dashFn,
		uvFn: props.uvFn,
		vertexFn: props.vertexFn,
		fragmentColorFn: props.fragmentColorFn,
		fragmentAlphaFn: props.fragmentAlphaFn,
		discardFn: props.discardFn,
	}
}

function configureLine( line ) {
	// Mark the current node pipeline dirty before applying all build-time options.
	// This lets configure() finish before rebuild() creates the next pipeline.
	line.positionFn( props.positionFn )
	line.configure( getBuildOptions() )
	line.dash( props.dash )
	return line
}

function applyLiveOptions() {
	const line = lineRef.value
	if ( !line ) return

	line.lineWidth( props.lineWidth )
	line.color( props.color )
	line.transparent( props.transparent || props.opacity < 1 || props.alphaMap != null )
	line.opacity( props.opacity )
	line.alphaTest( props.alphaTest )
	line.wireframe( props.wireframe )
	line.shadow( props.shadow )
	line.gradientColor( props.gradientColor ?? null )
	line.map( props.map ?? null )
	line.mapOffset( props.mapOffset ?? null )
	line.alphaMap( props.alphaMap ?? null )
	line.dash( props.dash )
	line.setFrustumCulled( resolveFrustumCulled() )
	line.verbose( props.verbose )
	line.dpr( props.dpr ?? defaultDpr() )
}

function applyRenderSize() {
	const line = lineRef.value
	if ( !line ) return

	const width = resolveRenderWidth()
	const height = resolveRenderHeight()
	line.renderSize( width, height )
	line.resize( width, height )
}

function attachLine() {
	if ( !mounted ) return

	const parent = resolveParent()
	if ( !parent ) {
		lineRef.value?.parent?.remove( lineRef.value )
		return
	}

	if ( !lineRef.value ) {
		const line = configureLine( new MeshLineCore() ).build()
		lineRef.value = line
		previousClosed = props.closed
		hadLinePoints = resolveLines() != null
		parent.add( line )
		emit( 'ready', line )
		return
	}

	if ( lineRef.value.parent !== parent ) parent.add( lineRef.value )
}

function rebuildLine() {
	const line = lineRef.value
	if ( !line ) return

	configureLine( line ).rebuild()
	previousClosed = props.closed
}

function disposeLine() {
	lineRef.value?.parent?.remove( lineRef.value )
	lineRef.value?.dispose()
	lineRef.value = null
}

function replaceLine() {
	disposeLine()
	attachLine()
}

onMounted( () => {
	mounted = true
	attachLine()
} )

onUnmounted( () => {
	mounted = false
	disposeLine()
} )

watch( resolveParent, attachLine, { flush: 'post' } )

// Point buffers and option objects are watched by identity. Replace their
// reference to trigger an update; use the exposed line for per-frame mutation.
watch( () => [resolveLines(), props.closed, props.updateBounding], () => {
	const line = lineRef.value
	const lines = resolveLines()
	const hasLinePoints = lines != null
	if ( hadLinePoints !== hasLinePoints ) {
		hadLinePoints = hasLinePoints
		replaceLine()
		return
	}
	if ( !line ) return

	if ( previousClosed !== props.closed ) {
		rebuildLine()
		return
	}

	line.setPositions( lines, props.updateBounding )
}, { flush: 'post' } )

watch( () => [
	props.segments,
	props.surface,
	props.join,
	props.cap,
	props.sizeAttenuation,
	props.widthCallback,
	props.vertexColors,
	props.smoothSharpBends,
	props.smoothSharpBendsAlpha,
	props.smoothSharpBendsThreshold,
	props.dynamic,
	props.gpuPositionNode,
	props.usage,
	props.instanceCount,
	props.needsUV,
	props.needsWidth,
	props.needsProgress,
	props.needsPrevious,
	props.needsNext,
	props.needsSide,
	props.needsVertexColor,
	props.positionFn,
	props.previousFn,
	props.nextFn,
	props.widthFn,
	props.normalFn,
	props.colorFn,
	props.gradientFn,
	props.opacityFn,
	props.dashFn,
	props.uvFn,
	props.vertexFn,
	props.fragmentColorFn,
	props.fragmentAlphaFn,
	props.discardFn,
	props.frustumCulled,
], rebuildLine, { flush: 'post' } )

watch( () => [
	props.lineWidth,
	props.color,
	props.opacity,
	props.alphaTest,
	props.transparent,
	props.wireframe,
	props.shadow,
	props.gradientColor,
	props.dash,
	props.map,
	props.mapOffset,
	props.alphaMap,
	props.dpr,
	props.verbose,
], applyLiveOptions, { flush: 'post' } )

watch( () => [props.renderWidth, props.renderHeight], applyRenderSize, { flush: 'post' } )

defineExpose( { line: lineRef } )
</script>

<template>
	<!-- Renderless: MeshLineCore is attached directly to the Three.js scene. -->
	<span v-if="false" />
</template>
