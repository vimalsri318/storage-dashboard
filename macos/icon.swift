import Cocoa
// Draws the app icon (1024x1024 PNG): green gradient squircle with three storage bars.
let size: CGFloat = 1024
let img = NSImage(size: NSSize(width: size, height: size))
img.lockFocus()
let rect = NSRect(x: 64, y: 64, width: size - 128, height: size - 128)
let path = NSBezierPath(roundedRect: rect, xRadius: 190, yRadius: 190)
NSGraphicsContext.current?.saveGraphicsState()
let shadow = NSShadow(); shadow.shadowColor = NSColor.black.withAlphaComponent(0.28); shadow.shadowBlurRadius = 36; shadow.shadowOffset = NSSize(width: 0, height: -14); shadow.set()
NSGradient(starting: NSColor(red: 0.30, green: 0.80, blue: 0.56, alpha: 1), ending: NSColor(red: 0.10, green: 0.55, blue: 0.36, alpha: 1))!.draw(in: path, angle: -90)
NSGraphicsContext.current?.restoreGraphicsState()
NSColor.white.withAlphaComponent(0.22).setStroke(); path.lineWidth = 3; path.stroke()
NSColor.white.setFill()
for (i, w) in [520.0, 520.0, 520.0].enumerated() {
    let y = 640.0 - Double(i) * 150
    NSBezierPath(roundedRect: NSRect(x: 252, y: y, width: w, height: 84), xRadius: 42, yRadius: 42).fill()
}
NSColor.white.withAlphaComponent(0.55).setFill()
NSBezierPath(roundedRect: NSRect(x: 252 + 400, y: 640.0 - 300, width: 120, height: 84), xRadius: 42, yRadius: 42).fill()
img.unlockFocus()
let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
