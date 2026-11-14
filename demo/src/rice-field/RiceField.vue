<template>
	<StandaloneApp class="RiceField" :demo="RicefieldExample" name="rice field" :pipelines="pipelines" />
</template>

<script setup>
import RicefieldExample from '@/demos/ricefield'
import StandaloneApp from '@/standalone/StandaloneApp.vue'

// Recorded by `pnpm capture:rice-field`: record it again after a change to the demo's shaders.
import pipelines from './pipelines.json?url'
</script>

<style lang="stylus">
// The sky at the horizon, which the scene opens on.
:root
	background #ffbb74

// The demo hint and controls are added to <body>: the hint leaves the brand its corner,
// and the controls sit between the corner pills while they fit, then drop below them.
body > .DemoHint
	top auto
	bottom calc(18px + var(--saib))

// On a row of their own, the controls need not leave room for the gallery's corner buttons.
@media (max-width: 900px)
	body > .DemoControls
		top calc(66px + var(--sait))
		max-width calc(100vw - 24px)

@media (max-width: 640px)
	body > .DemoHint
		left calc(12px + var(--sail))
		bottom calc(12px + var(--saib))

	body > .DemoControls
		top calc(54px + var(--sait))
</style>
