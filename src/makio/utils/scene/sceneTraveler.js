// Manage transition betweenScene
//
// @usage SceneTraveler.to( new Scene() )
// @author David Ronai / @Makio64

import stage from '@/makio/core/stage'

export class SceneTraveler {
	constructor() {
		this.currentScene = null
		this.nextScene = null

		stage.onUpdate.add( this.update )
		stage.onResize.add( this.resize )
	}

	to = ( scene ) => {
		this.nextScene = scene
		if ( this.currentScene ) {
			this.currentScene.transitionOut()
		} else {
			this.onTransitionOutComplete()
		}
	}

	update = ( dt ) => {
		if ( this.currentScene ) {
			this.currentScene.update( dt )
		}
	}

	onTransitionOutComplete = () => {
		if ( this.currentScene && this.currentScene.dispose ) {
			this.currentScene.dispose()
		}
		this.currentScene = this.nextScene
		if ( this.currentScene.transitionIn ) {
			this.currentScene.transitionIn()
		}
	}

	resize = () => {
		if ( this.currentScene && this.currentScene.resize ) {
			this.currentScene.resize()
		}
		if ( this.nextScene && this.nextScene.resize ) {
			this.nextScene.resize()
		}
	}
}

export default new SceneTraveler()
