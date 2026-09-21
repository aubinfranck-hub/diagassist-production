package com.diagassist.technician
import android.app.*
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.IBinder
import androidx.core.app.NotificationCompat
class ScreenCaptureService:Service(){
 override fun onCreate(){super.onCreate(); val nm=getSystemService(NOTIFICATION_SERVICE) as NotificationManager; nm.createNotificationChannel(NotificationChannel("diagassist","DiagAssist V2",NotificationManager.IMPORTANCE_LOW))}
 override fun onStartCommand(i:Intent?,flags:Int,startId:Int):Int{
  val n=NotificationCompat.Builder(this,"diagassist").setContentTitle("DiagAssist V2").setContentText("Capture écran active").setSmallIcon(android.R.drawable.ic_menu_view).build(); startForeground(1001,n)
  val code=i?.getIntExtra("resultCode",0)?:return START_NOT_STICKY; val data=i.getParcelableExtra<Intent>("resultData")?:return START_NOT_STICKY
  val manager=getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager; manager.getMediaProjection(code,data)
  // Étape suivante : ImageReader + VirtualDisplay + compression + WSS.
  return START_STICKY
 }
 override fun onBind(i:Intent?):IBinder?=null
}