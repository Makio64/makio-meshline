<template>
	<div class="DemoControls" role="group" aria-label="Sculpture morph target" @pointerdown.stop>
		<button
			type="button"
			style="--demo-accent: #fb923c"
			title="Morph to David"
			:aria-pressed="selected === 'david'"
			@click="morphTo( 'david' )"
		>
			David
		</button>
		<button
			type="button"
			style="--demo-accent: #f472b6"
			title="Morph to Venus"
			:aria-pressed="selected === 'venus'"
			@click="morphTo( 'venus' )"
		>
			Venus
		</button>
	</div>
</template>

<script>
import '@/utils/demoHud.styl'

// A Vue pill rather than createDemoControls: the docs embed runs with `?noUI` and still
// needs it to morph, and each statue has its own accent.
export default {
	name: 'VenusUI',
	props: {
		api: { type: Object, required: true },
	},
	data() {
		return {
			selected: 'david',
		}
	},
	methods: {
		morphTo( statue ) {
			this.selected = statue
			this.api[statue]()
		},
	},
}
</script>
