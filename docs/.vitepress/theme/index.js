import DefaultTheme from 'vitepress/theme'
import { onMounted, watch, nextTick, h } from 'vue'
import { useRoute } from 'vitepress'
import TrailBackground from './TrailBackground.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    // Optional: Add any app-level enhancements here
  },
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'layout-top': () => h(TrailBackground)
    })
  },
  setup() {
    const route = useRoute()
    
    // Force hide aside on example pages
    onMounted(() => {
      hideAsideIfNeeded()
    })
    
    watch(() => route.path, () => {
      nextTick(() => {
        hideAsideIfNeeded()
      })
    })
    
    function hideAsideIfNeeded() {
      // Check if we're on an example page
      const isExamplePage = route.path.includes('/examples/')
      
      if (isExamplePage) {
        // Force hide ONLY the right aside (table of contents), not the left sidebar
        const rightAsideElements = document.querySelectorAll('.aside')
        rightAsideElements.forEach(el => {
          el.style.display = 'none'
          el.style.visibility = 'hidden'
          el.style.width = '0'
        })
        
        // Force full width on content
        const contentElements = document.querySelectorAll('.VPDoc .content, .VPContent .content, .content-container')
        contentElements.forEach(el => {
          el.style.maxWidth = '100%'
          el.style.width = '100%'
        })
        
        // Remove padding from doc
        const docElements = document.querySelectorAll('.VPDoc, .VPDoc.has-aside')
        docElements.forEach(el => {
          el.style.paddingRight = '0'
        })
      }
    }
  }
}