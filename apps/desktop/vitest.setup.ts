const testNavigator = globalThis.navigator ?? {}

Object.defineProperties(testNavigator, {
  languages: { configurable: true, value: ['zh-CN'] },
  language: { configurable: true, value: 'zh-CN' },
})

if (typeof globalThis.navigator === 'undefined') {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: testNavigator,
  })
}
