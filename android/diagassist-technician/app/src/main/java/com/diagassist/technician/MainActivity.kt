package com.diagassist.technician
import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import androidx.activity.ComponentActivity
class MainActivity : ComponentActivity() {
 private val requestCode=9001
 override fun onCreate(state:Bundle?){super.onCreate(state); val m=getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager; startActivityForResult(m.createScreenCaptureIntent(),requestCode)}
 override fun onActivityResult(code:Int,result:Int,data:Intent?){super.onActivityResult(code,result,data); if(code==requestCode&&result==Activity.RESULT_OK&&data!=null){startForegroundService(Intent(this,ScreenCaptureService::class.java).apply{putExtra("resultCode",result);putExtra("resultData",data)})}}
}