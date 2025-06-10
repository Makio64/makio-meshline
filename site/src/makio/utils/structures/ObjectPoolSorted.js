import DoubleLinkedList from './DoubleLinkedList'

/**
 * ObjectPoolSorted : ObjectPool using a doubleLinkedList to store available items.
 * @author David Ronai | @Makio64
 * */
export default class ObjectPool {
	constructor( createFunc, initialSize = 0, isSorted = true, indexKey = 'index' ) {
		this.canExpand = false
		this.size = initialSize
		this.createFunc = createFunc
		this.availableItems = new DoubleLinkedList()
		this.availableItems.indexKey = indexKey
		if ( createFunc ) {
			for ( let i = 0; i < initialSize; i++ ) {
				if ( isSorted ) {
					this.availableItems.insertSorted( this.createFunc( i ) )
				} else {
					this.availableItems.add( this.createFunc( i ) )
				}
			}
		}
	}

	pop() {
		return this.checkOut()
	}
	checkOut() {
		if ( this.size == 0 ) {
			console.warn( 'object pool empty' )
			return this.canExpand ? this.createFunc( 0 ) : null
		} else {
			this.size--
			return this.availableItems.pop()
		}
	}

	shift() {
		if ( this.availableItems.size == 0 ) {
			console.warn( 'object pool empty' )
			return this.canExpand ? this.createFunc( 0 ) : null
		} else {
			this.size--
			return this.availableItems.shift()
		}
	}

	checkIn( item ) {
		this.size++
		this.availableItems.add( item )
	}

	checkInSort( item ) {
		this.size++
		this.availableItems.insertSorted( item )
	}

	isEmpty() {
		return this.size == 0
	}

	get() {
		return this.checkOut()
	}
	release( item ) {
		return this.checkIn( item )
	}
}
