/**
 * ObjectPool: Manages a pool of reusable objects to optimize memory use.
 * @author David Ronai / @Makio64
 */

export default class ObjectPool {
	constructor( createFunc, initialSize = 0, canExpand = true ) {
		this.size = initialSize
		this.canExpand = canExpand
		this.createFunc = createFunc
		this.availableItems = []
		for ( let i = 0; i < initialSize; i++ ) {
			this.availableItems.push( this.createFunc() )
		}
	}

	checkOut() {
		if ( this.size === 0 ) {
			console.warn( 'The pool is empty.' )
			if ( !this.canExpand ) {
				return null
			}
			return this.createFunc()
		}

		this.size--
		return this.availableItems.pop()
	}

	checkIn( item ) {
		this.size++
		this.availableItems.push( item )
	}

	get() {
		return this.checkOut()
	}

	release( item ) {
		return this.checkIn( item )
	}
}
