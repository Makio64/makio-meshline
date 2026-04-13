<script setup>
import { inject, onMounted, onUnmounted, watch, shallowRef } from 'vue'
import { MeshLine as MeshLineCore } from 'makio-meshline'

const props = defineProps( {
	parent: { type: Object, default: null },
	points: { type: [Array, Float32Array], required: true },
	closed: { type: Boolean, default: false },
	lineWidth: { type: Number, default: 0.1 },
	color: { type: Number, default: 0xffffff },
	gradientColor: { type: Number, default: null },
	dash: { type: Object, default: null },
	map: { type: Object, default: null },
	opacity: { type: Number, default: 1 },
	transparent: { type: Boolean, default: false },
	sizeAttenuation: { type: Boolean, default: true },
	widthFn: { type: Function, default: null },
	colorFn: { type: Function, default: null },
	opacityFn: { type: Function, default: null },
	gradientFn: { type: Function, default: null },
	uvFn: { type: Function, default: null },
	dashFn: { type: Function, default: null },
	positionFn: { type: Function, default: null },
	fragmentColorFn: { type: Function, default: null },
	fragmentAlphaFn: { type: Function, default: null },
	discardFn: { type: Function, default: null },
	vertexFn: { type: Function, default: null },
} )

const emit = defineEmits( ['ready'] )
const lineRef = shallowRef( null )
const injectedParent = inject( 'meshline-parent', null )

function buildAndAdd() {
	disposeLine()
	const parent = props.parent || ( injectedParent?.value ?? injectedParent )
	if ( !parent ) return

	const line = new MeshLineCore()
		.lines( props.points )
		.closed( props.closed )
		.lineWidth( props.lineWidth )
		.color( props.color )
		.sizeAttenuation( props.sizeAttenuation )

	if ( props.gradientColor != null ) line.gradientColor( props.gradientColor )
	if ( props.dash ) line.dash( props.dash )
	if ( props.map ) line.map( props.map )
	if ( props.transparent || props.opacity < 1 ) line.transparent( true ).opacity( props.opacity )

	if ( props.widthFn ) line.widthFn( props.widthFn )
	if ( props.colorFn ) line.colorFn( props.colorFn )
	if ( props.opacityFn ) line.opacityFn( props.opacityFn )
	if ( props.gradientFn ) line.gradientFn( props.gradientFn )
	if ( props.uvFn ) line.uvFn( props.uvFn )
	if ( props.dashFn ) line.dashFn( props.dashFn )
	if ( props.positionFn ) line.positionFn( props.positionFn )
	if ( props.fragmentColorFn ) line.fragmentColorFn( props.fragmentColorFn )
	if ( props.fragmentAlphaFn ) line.fragmentAlphaFn( props.fragmentAlphaFn )
	if ( props.discardFn ) line.discardFn( props.discardFn )
	if ( props.vertexFn ) line.vertexFn( props.vertexFn )

	line.build()
	parent.add( line )
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

// Rebuild only when geometry-changing props change
watch( () => [props.points, props.closed, props.sizeAttenuation], buildAndAdd, { flush: 'post' } )

// Live-update material props without rebuild
watch( () => props.lineWidth, ( v ) => lineRef.value?.material?.lineWidth?.( v ) )
watch( () => props.color, ( v ) => lineRef.value?.material?.color?.( v ) )

defineExpose( { line: lineRef } )
</script>

<template>
	<!-- renderless -->
</template>
