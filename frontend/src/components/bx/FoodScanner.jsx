// Live EAN/UPC scanner for food packages in the browser/PWA. The app build uses ML Kit's own
// full-screen scanner instead (lib/scan.js scanCode); iOS Safari has no BarcodeDetector, so there
// the view offers typing the digits — this component is only mounted where canScanInBrowser().
// Nothing leaves the device: frames are decoded locally and only the digits are kept.
import { useEffect, useRef, useState } from 'react'
import { t } from '../../lib/i18n.js'
import { FOOD_BARCODE_FORMATS, foodBarcode } from '../../lib/nutrition.js'

export const canScanInBrowser = () =>
  typeof globalThis.BarcodeDetector === 'function' && !!navigator.mediaDevices?.getUserMedia

export default function FoodScanner({ onFound, onCancel }) {
  const videoRef = useRef(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let stream = null, timer = null, done = false
    const stop = () => {
      done = true
      if (timer) clearTimeout(timer)
      if (stream) stream.getTracks().forEach(tr => tr.stop())
    }
    ;(async () => {
      let detector
      try { detector = new globalThis.BarcodeDetector({ formats: FOOD_BARCODE_FORMATS }) }
      catch { setError('unavailable'); return }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      } catch (e) {
        setError(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'denied' : 'unavailable')
        return
      }
      if (done) { stop(); return }
      const v = videoRef.current
      v.srcObject = stream
      try { await v.play() } catch { /* autoplay policies: the muted inline video still renders */ }
      const tick = async () => {
        if (done) return
        try {
          const codes = await detector.detect(v)
          const code = codes.map(c => foodBarcode(c.rawValue)).find(Boolean)
          if (code) { stop(); onFound(code); return }
        } catch { /* a frame that could not be read: try the next one */ }
        timer = setTimeout(tick, 180)
      }
      tick()
    })()
    return stop
  }, [onFound])

  return (
    <div>
      {error
        ? <div className="bx-alert" role="alert">
            {error === 'denied' ? t('Camera access was refused. Allow it in the browser settings, or type the barcode.') : t('This browser cannot scan barcodes. Type the digits under the bars instead.')}
          </div>
        : <div style={{ position: 'relative', borderRadius: 'var(--bx-r-lg)', overflow: 'hidden', background: '#000', aspectRatio: '4 / 3' }}>
            <video ref={videoRef} muted playsInline aria-label={t('Camera')} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            {/* the aiming band: where the bars should sit */}
            <div aria-hidden="true" style={{ position: 'absolute', left: '10%', right: '10%', top: '38%', height: '24%', border: '2px solid var(--bx-volt)', borderRadius: 'var(--bx-r)', boxShadow: '0 0 0 999px rgba(0,0,0,.35)' }} />
          </div>}
      <button className="bx-btn bx-btn-ghost bx-btn-block bx-tap" style={{ marginTop: 'var(--bx-s3)' }} onClick={onCancel}>{t('Cancel')}</button>
    </div>
  )
}
