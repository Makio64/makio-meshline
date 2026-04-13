<script setup>
import { ref, shallowRef, onMounted, onUnmounted } from 'vue'
import * as THREE from 'three/webgpu'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { circlePositions } from 'makio-meshline'
import MeshLine from './MeshLine.vue'

const canvasRef = ref()
const group = shallowRef( null )
const points = circlePositions( 64, 3 )
let renderer, scene, camera, controls, rafId

onMounted( async () => {
	scene = new THREE.Scene()
	camera = new THREE.PerspectiveCamera( 55, innerWidth / innerHeight, 0.1, 1000 )
	camera.position.z = 10

	renderer = new THREE.WebGPURenderer( { canvas: canvasRef.value, antialias: true } )
	renderer.setSize( innerWidth, innerHeight )
	renderer.setPixelRatio( devicePixelRatio )
	await renderer.init()

	controls = new OrbitControls( camera, renderer.domElement )
	controls.enableDamping = true

	const g = new THREE.Group()
	scene.add( g )
	group.value = g

	const loop = () => {
		controls.update()
		if ( group.value ) group.value.rotation.z += 0.005
		renderer.render( scene, camera )
		rafId = requestAnimationFrame( loop )
	}
	loop()

	window.addEventListener( 'resize', onResize )
} )

function onResize() {
	camera.aspect = innerWidth / innerHeight
	camera.updateProjectionMatrix()
	renderer.setSize( innerWidth, innerHeight )
}

onUnmounted( () => {
	cancelAnimationFrame( rafId )
	window.removeEventListener( 'resize', onResize )
	controls?.dispose()
	renderer?.dispose()
} )
</script>

<template>
	<canvas ref="canvasRef" />
	<MeshLine
		v-if="group"
		:parent="group"
		:points="points"
		closed
		:line-width="0.2"
		:color="0xff8800"
		:gradient-color="0xffffff"
	/>
</template>
