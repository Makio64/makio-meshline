<template>
	<StandaloneApp class="TrackMaker" :demo="SurfaceRoadExample" name="track maker" />
</template>

<script setup>
import SurfaceRoadExample from '@/demos/surfaceRoad'
import StandaloneApp from '@/standalone/StandaloneApp.vue'
</script>

<style lang="stylus">
:root
	background #b9d6e3

// The road toolbar sits between the corner pills while it fits, then drops below them.
@media (max-width: 1100px)
	.TrackMaker .SurfaceRoadHud
		top calc(66px + var(--sait))

	.TrackMaker .SurfaceRoadSaves
		top calc(112px + var(--sait))

@media (max-width: 640px)
	.TrackMaker .SurfaceRoadHud
		top calc(54px + var(--sait))
		max-width calc(100vw - 24px)

	.TrackMaker .SurfaceRoadSaves
		top calc(106px + var(--sait))

	.TrackMaker .SurfaceRoadPoint,
	.TrackMaker .SurfaceRoadRide
		bottom calc(12px + var(--saib))
</style>
