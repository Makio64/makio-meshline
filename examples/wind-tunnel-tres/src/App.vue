<script setup>
import { TresCanvas } from '@tresjs/core/webgpu'
import { WIND_TUNNEL_CAMERA } from 'makio-meshline-wind-tunnel-example'
import { PerspectiveCamera, WebGPURenderer } from 'three/webgpu'
import { markRaw, onBeforeUnmount, onMounted, ref, toValue } from 'vue'

import WindTunnel from './WindTunnel.vue'

const modes = [['tunnel', 'Full tunnel'], ['rake', 'Smoke rake'], ['ground', 'Ground effect']]
const preference = matchMedia( '(prefers-reduced-motion: reduce)' )
const reducedMotion = ref( preference.matches )
const playing = ref( !preference.matches )
const visible = ref( !document.hidden )
const mode = ref( 'tunnel' )
const wind = ref( 200 )
const crosswind = ref( false )
const ready = ref( false )
const status = ref( 'Starting native WebGPU…' )
const previewUrl = `${import.meta.env.BASE_URL}preview.jpg`
const error = ref( navigator.gpu ? '' : 'This compute scene requires native WebGPU. Open it in a browser with WebGPU enabled over HTTPS or localhost.' )
const camera = markRaw( new PerspectiveCamera( WIND_TUNNEL_CAMERA.fov, 1, WIND_TUNNEL_CAMERA.near, WIND_TUNNEL_CAMERA.far ) )
camera.position.fromArray( WIND_TUNNEL_CAMERA.position )
camera.lookAt( ...WIND_TUNNEL_CAMERA.target )

// Tres initializes and owns the renderer returned by this synchronous factory.
const createRenderer = context => new WebGPURenderer( { canvas: toValue( context.canvas ), antialias: true } )
const showError = failure => { error.value = failure.message || String( failure ) }
const reload = () => location.reload()
const preferenceChanged = () => {
	reducedMotion.value = preference.matches
	if ( preference.matches ) playing.value = false
}
const visibilityChanged = () => { visible.value = !document.hidden }

onMounted( () => {
	preference.addEventListener( 'change', preferenceChanged )
	document.addEventListener( 'visibilitychange', visibilityChanged )
} )
onBeforeUnmount( () => {
	preference.removeEventListener( 'change', preferenceChanged )
	document.removeEventListener( 'visibilitychange', visibilityChanged )
} )
</script>

<template>
	<main>
		<TresCanvas v-if="!error" :camera="camera" :renderer="createRenderer" :dpr="[1, 1.5]" @error="showError">
			<WindTunnel :playing="playing" :visible="visible" :reduced-motion="reducedMotion" :mode="mode" :wind="wind" :crosswind="crosswind" @ready="ready = true" @status="status = $event" @error="showError" />
		</TresCanvas>
		<div v-if="!ready || error" class="loading">
			<img :src="previewUrl" alt="Glowing smoke streamlines passing around a hover car">
			<div class="notice" :role="error ? 'alert' : 'status'">
				<strong>{{ error ? 'Wind tunnel unavailable' : 'Opening the wind tunnel' }}</strong>
				<p>{{ error || status }}</p>
				<button v-if="error" type="button" @click="reload">Try again</button>
			</div>
		</div>
		<header><span>Makio MeshLine</span><h1>Wind Tunnel</h1><p>TresJS / Vue 3 · V2 development preview · unreleased</p></header>
		<section class="controls" aria-label="Wind tunnel controls">
			<div class="modes">
				<button v-for="[id, label] in modes" :key="id" type="button" :aria-pressed="mode === id" :disabled="!ready || Boolean(error)" @click="mode = id">{{ label }}</button>
			</div>
			<label class="speed"><span>Wind <output>{{ wind }} km/h</output></span><input v-model.number="wind" type="range" min="80" max="500" step="10" :disabled="!ready || Boolean(error)"></label>
			<div class="toggles"><button type="button" :disabled="!ready || Boolean(error)" @click="playing = !playing">{{ playing ? 'Pause animation' : 'Play animation' }}</button><label><input v-model="crosswind" type="checkbox" :disabled="!ready || Boolean(error)">Crosswind</label></div>
			<p>Drag to orbit · move to steer airflow{{ reducedMotion ? ' · reduced motion' : '' }}</p>
		</section>
		<footer><a href="https://github.com/Makio64/makio-meshline">Source workspace</a><a href="https://meshline.makio.io/">MeshLine docs</a></footer>
	</main>
</template>
