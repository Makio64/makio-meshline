// Abstract Scene
// @author David Ronai / Makiopolis.com / @Makio64

import sceneTraveler from '@/makio/core/sceneTraveler'

export default class Scene {
	constructor( name = 'default' ) {
		this.name = name
	}

	update( dt ) {}

	resize() {}

	transitionIn() {
		this.onTransitionInComplete()
	}

	transitionOut() {
		this.onTransitionOutComplete()
	}

	onTransitionInComplete = () => {}

	onTransitionOutComplete = () => {
		sceneTraveler.onTransitionOutComplete()
	}

	dispose() {}
}

export { Scene }
