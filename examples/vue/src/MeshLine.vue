<script setup>
import { inject, onMounted, onUnmounted, shallowRef, unref, watch } from 'vue'
import { MeshLine as MeshLineCore } from 'makio-meshline'

const props = defineProps( {
	parent: { type: Object, default: null },
	points: { type: [Array, Float32Array], default: null },
	lines: { type: [Array, Float32Array], default: null },
	segments: { type: Number, default: undefined },
	closed: { type: [Boolean, Array], default: false },
	lineWidth: { type: Number, default: 0.1 },
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
	join: { type: Object, default: null },
	smoothSharpBends: { type: Boolean, default: false },
	smoothSharpBendsAlpha: { type: Number, default: undefined },
	smoothSharpBendsThreshold: { type: Number, default: undefined },
	dpr: { type: Number, default: undefined },
	frustumCulled: { type: Boolean, default: true },
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
	updateBounding: { type: Boolean, default: false },
} )

const emit = defineEmits( ['ready'] )
const lineRef = shallowRef( null )
const injectedParent = inject( 'meshline-parent', null )
let previousClosed = props.closed

function resolveParent() {
	return unref( props.parent ) || unref( injectedParent )
}

function resolveLines() {
	return props.points ?? props.lines
}

function getBuildOptions() {
	return {
		lines: resolveLines(),
		segments: props.segments,
		closed: props.closed,
		vertexColors: props.vertexColors,
		color: props.color,
		lineWidth: props.lineWidth,
		widthCallback: props.widthCallback,
		sizeAttenuation: props.sizeAttenuation,
		gradientColor: props.gradientColor,
		dash: props.dash,
		map: props.map,
		mapOffset: props.mapOffset,
		alphaMap: props.alphaMap,
		opacity: props.opacity,
		alphaTest: props.alphaTest,
		transparent: props.transparent || props.opacity < 1,
		wireframe: props.wireframe,
		shadow: props.shadow,
		join: props.join,
		smoothSharpBends: props.smoothSharpBends,
		smoothSharpBendsAlpha: props.smoothSharpBendsAlpha,
		smoothSharpBendsThreshold: props.smoothSharpBendsThreshold,
		dpr: props.dpr,
		frustumCulled: props.frustumCulled,
		verbose: props.verbose,
		renderWidth: props.renderWidth,
		renderHeight: props.renderHeight,
		dynamic: props.dynamic,
		gpuPositionNode: props.gpuPositionNode,
		usage: props.usage,
		instanceCount: props.instanceCount,
		needsUV: props.needsUV,
		needsWidth: props.needsWidth,
		needsProgress: props.needsProgress,
		needsPrevious: props.needsPrevious,
		needsNext: props.needsNext,
		needsSide: props.needsSide,
		needsVertexColor: props.needsVertexColor,
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

function applyBuildOptions( line ) {
	const { dash, join, ...options } = getBuildOptions()
	line.configure( options )
	line.dash( dash )
	if ( join ) line.join( join )
	return line
}

function applyLiveOptions() {
	const line = lineRef.value
	if ( !line ) return

	line.lineWidth( props.lineWidth )
	line.color( props.color )
	line.transparent( props.transparent || props.opacity < 1 )
	line.opacity( props.opacity )
	line.alphaTest( props.alphaTest )
	line.wireframe( props.wireframe )
	line.shadow( props.shadow )
	line.gradientColor( props.gradientColor ?? null )
	line.map( props.map ?? null )
	line.alphaMap( props.alphaMap ?? null )
	line.dash( props.dash )
	line.setFrustumCulled( props.frustumCulled )
	line.verbose( props.verbose )
	line.join( props.join ?? undefined )

	line.mapOffset( props.mapOffset ?? null )
	if ( props.dpr !== undefined ) line.dpr( props.dpr )
	if ( props.renderWidth !== undefined || props.renderHeight !== undefined ) {
		line.renderSize( props.renderWidth, props.renderHeight )
		line.resize( props.renderWidth, props.renderHeight )
	}
}

function buildAndAdd() {
	disposeLine()
	const parent = resolveParent()
	if ( !parent ) return

	const line = applyBuildOptions( new MeshLineCore() )
	line.build()
	parent.add( line )
	previousClosed = props.closed
	lineRef.value = line
	emit( 'ready', line )
}

function disposeLine() {
	if ( !lineRef.value ) return
	lineRef.value.parent?.remove( lineRef.value )
	lineRef.value.dispose()
	lineRef.value = null
}

onMounted( buildAndAdd )
onUnmounted( disposeLine )

watch( resolveParent, buildAndAdd, { flush: 'post' } )

watch( () => [resolveLines(), props.closed, props.updateBounding], () => {
	const line = lineRef.value
	if ( !line ) {
		buildAndAdd()
		return
	}

	const lines = resolveLines()
	if ( lines == null ) {
		line.closed( props.closed ).rebuild()
		previousClosed = props.closed
		return
	}

	if ( previousClosed !== props.closed ) {
		line.lines( lines, props.closed )
		previousClosed = props.closed
		return
	}

	line.setPositions( lines, props.updateBounding )
}, { flush: 'post' } )

watch( () => [
	props.segments,
	props.sizeAttenuation,
	props.widthCallback,
	props.vertexColors,
	props.join,
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
], buildAndAdd, { flush: 'post' } )

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
	props.frustumCulled,
	props.verbose,
	props.renderWidth,
	props.renderHeight,
], applyLiveOptions, { deep: true, flush: 'post' } )

defineExpose( { line: lineRef } )
</script>

<template>
  <span v-if="false" />
</template>
