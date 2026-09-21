package com.diagassist.technician

import android.app.*
import android.content.*
import android.graphics.*
import android.hardware.display.DisplayManager
import android.media.ImageReader
import android.media.projection.MediaProjectionManager
import android.os.*
import android.util.Base64
import androidx.core.app.NotificationCompat
import okhttp3.*
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class ScreenCaptureService:Service(){
 private var reader:ImageReader?=null
 private var display:android.hardware.display.VirtualDisplay?=null
 private var socket:WebSocket?=null
 private var projection:android.media.projection.MediaProjection?=null
 private val executor=Executors.newSingleThreadExecutor()
 private var sequence=0
 private var previousHash:String?=null
 override fun onCreate(){super.onCreate(); val nm=getSystemService(NOTIFICATION_SERVICE) as NotificationManager; nm.createNotificationChannel(NotificationChannel("diagassist","DiagAssist V2",NotificationManager.IMPORTANCE_LOW))}
 override fun onStartCommand(i:Intent?,flags:Int,startId:Int):Int{
  startForeground(1001,NotificationCompat.Builder(this,"diagassist").setContentTitle("DiagAssist V2").setContentText("Capture écran active").setSmallIcon(android.R.drawable.ic_menu_view).build())
  val code=i?.getIntExtra("resultCode",0)?:return START_NOT_STICKY
  val data=i.getParcelableExtra<Intent>("resultData")?:return START_NOT_STICKY
  val wsUrl=i.getStringExtra("wsUrl")?:return START_NOT_STICKY
  val sessionId=i.getStringExtra("sessionId")?:return START_NOT_STICKY
  val pairing=i.getStringExtra("pairingCode")?:return START_NOT_STICKY
  val token=i.getStringExtra("token")?:return START_NOT_STICKY
  val manager=getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
  projection=manager.getMediaProjection(code,data)
  connect(wsUrl,token,sessionId,pairing)
  return START_STICKY
 }
 private fun connect(base:String,token:String,session:String,pairing:String){
  currentSession=session;
  val url=base.trimEnd("/")+"/api/screening/stream?token="+java.net.URLEncoder.encode(token,"UTF-8")
  val client=OkHttpClient.Builder().pingInterval(30,TimeUnit.SECONDS).build()
  socket=client.newWebSocket(Request.Builder().url(url).build(),object:WebSocketListener(){
   override fun onOpen(ws:WebSocket,response:Response){ws.send(JSONObject(mapOf("type" to "pairing","sessionId" to session,"pairingCode" to pairing)).toString()); startCapture()}
   override fun onMessage(ws:WebSocket,text:String){handleCommand(text)}
  })
 }
 private fun startCapture(){
  val metrics=resources.displayMetrics; val w=metrics.widthPixels; val h=metrics.heightPixels; val density=metrics.densityDpi
  reader=ImageReader.newInstance(w,h,android.graphics.PixelFormat.RGBA_8888,2)
  reader!!.setOnImageAvailableListener({r->executor.execute{process(r.acquireLatestImage(),w,h)}},null)
  display=projection?.createVirtualDisplay("DiagAssist",w,h,density,DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,reader!!.surface,null,null)
 }
 private fun process(image:android.media.Image?,w:Int,h:Int){
  if(image==null)return
  try{
   val p=image.planes[0]; val bmp=Bitmap.createBitmap(w,h,Bitmap.Config.ARGB_8888); val buf=p.buffer; bmp.copyPixelsFromBuffer(buf);
   val small=Bitmap.createScaledBitmap(bmp,32,32,true); val digest=MessageDigest.getInstance("SHA-256"); val bytes=ByteArray(32*32*4); small.copyPixelsToBuffer(java.nio.ByteBuffer.wrap(bytes)); val hash=Base64.encodeToString(digest.digest(bytes),Base64.NO_WRAP)
   if(hash==previousHash){bmp.recycle();small.recycle();return}; previousHash=hash; small.recycle()
   val out=ByteArrayOutputStream(); bmp.compress(Bitmap.CompressFormat.JPEG,70,out); bmp.recycle()
   val b64=Base64.encodeToString(out.toByteArray(),Base64.NO_WRAP); sequence++
   socket?.send(JSONObject(mapOf("type" to "frame","sessionId" to currentSession,"payload" to JSONObject(mapOf("frameId" to "frame_"+sequence,"sequence" to sequence,"imageData" to "data:image/jpeg;base64,"+b64,"mimeType" to "image/jpeg","width" to w,"height" to h)))).toString())
  }catch(_:Exception){}finally{image.close()}
 }
 private var currentSession:String=""
 private fun handleCommand(text:String){
  try{
    val m=JSONObject(text)
    when(m.optString("type")){
      "pairing" -> currentSession=m.optString("sessionId")
      "command" -> {
        val payload=m.optJSONObject("payload") ?: return
        val action=payload.optString("action")
        when(action){
          "request_screen" -> executor.execute { captureCurrentFrame() }
          "click","scroll","input","back" -> RemoteCommandBus.dispatch(action,payload.toString())
        }
      }
    }
  }catch(_:Exception){}
}
private fun captureCurrentFrame(){
  reader?.acquireLatestImage()?.let { image ->
    val metrics=resources.displayMetrics
    process(image,metrics.widthPixels,metrics.heightPixels)
  }
}
 override fun onDestroy(){socket?.close(1000,"stop"); display?.release(); reader?.close(); projection?.stop(); executor.shutdownNow(); super.onDestroy()}
 override fun onBind(i:Intent?):IBinder?=null
}