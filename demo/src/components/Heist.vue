<template>
	<div class="DemoControls" role="group" aria-label="Laser picking mode" @pointerdown.stop>
		<button
			v-for="mode in modes"
			:key="mode.id"
			type="button"
			:style="{ '--demo-accent': mode.color }"
			:aria-pressed="String( pickMode === mode.id )"
			@click="selectMode( mode.id )"
		>
			{{ mode.label }}
		</button>
		<kbd title="Press P to cycle modes">P</kbd>
	</div>
</template>

<script>
import { onShortcut } from '@/utils/demoControls'

// A Vue pill rather than createDemoControls: each mode has its own accent, and the
// pill stays under `?noUI` and works while init() is still loading.
export default {
	name: 'HeistUI',
	props: {
		api: { type: Object, required: true },
	},
	data() {
		return {
			pickMode: this.api.pickMode,
			modes: [
				{ id: 'raycast', label: 'Raycast (CPU)', color: '#4ad8ff' },
				{ id: 'picker', label: 'MeshLinePicker (GPU)', color: '#ff9368' },
				{ id: 'picker-debug', label: 'Picker Debug', color: '#7cffb2' },
			],
		}
	},
	mounted() {
		onShortcut( 'p', this.togglePickMode )
	},
	methods: {
		selectMode( mode ) {
			this.pickMode = this.api.setPickMode( mode )
		},
		togglePickMode() {
			this.pickMode = this.api.togglePickMode()
		},
	},
}
</script>
