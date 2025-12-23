const nodemailer = require('nodemailer');
const ApiError = require('../utils/ApiError');

class EventEmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  // Send registration confirmation email
  async sendRegistrationConfirmation(registration, event) {
    const emailTemplate = this.getRegistrationTemplate(registration, event);

    const mailOptions = {
      from: process.env.FROM_EMAIL,
      to: registration.user.email,
      subject: `تأكيد التسجيل - ${event.title}`,
      html: emailTemplate.html,
      text: emailTemplate.text,
    };

    try {
      await this.transporter.sendMail(mailOptions);
    } catch (error) {
      throw new ApiError(500, 'Failed to send confirmation email');
    }
  }

  // Send cancellation confirmation email
  async sendCancellationConfirmation(registration, event) {
    const emailTemplate = this.getCancellationTemplate(registration, event);

    const mailOptions = {
      from: process.env.FROM_EMAIL,
      to: registration.user.email,
      subject: `إلغاء التسجيل - ${event.title}`,
      html: emailTemplate.html,
      text: emailTemplate.text,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log(`Cancellation confirmation sent to ${registration.user.email}`);
    } catch (error) {
      console.error('Email sending failed:', error);
      throw new ApiError(500, 'Failed to send cancellation email');
    }
  }

  // Send event reminder email
  async sendEventReminder(registration, event) {
    const emailTemplate = this.getReminderTemplate(registration, event);

    const mailOptions = {
      from: process.env.FROM_EMAIL,
      to: registration.user.email,
      subject: `تذكير بالفعالية - ${event.title}`,
      html: emailTemplate.html,
      text: emailTemplate.text,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log(`Event reminder sent to ${registration.user.email}`);
    } catch (error) {
      console.error('Email sending failed:', error);
      throw new ApiError(500, 'Failed to send reminder email');
    }
  }

  // Email templates
  getRegistrationTemplate(registration, event) {
    const eventDate = new Date(event.date).toLocaleDateString('ar-SA');
    const eventTime = `${event.startTime} - ${event.endTime}`;

    const html = `
      <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #299CF7;">تأكيد التسجيل في فعالية ${event.title}</h2>
        
        <p>عزيزي/عزيزتي ${registration.user.fullName},</p>
        
        <p>نؤكد لك تسجيلك في فعالية <strong>${event.title}</strong></p>
        
        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3>تفاصيل الفعالية:</h3>
          <p><strong>التاريخ:</strong> ${eventDate}</p>
          <p><strong>الوقت:</strong> ${eventTime}</p>
          <p><strong>المكان:</strong> ${event.location}</p>
          <p><strong>رقم التأكيد:</strong> ${registration.confirmationCode}</p>
        </div>
        
        <p>يرجى الاحتفاظ برقم التأكيد للمراجعة.</p>
        
        <p>نتطلع لرؤيتك في الفعالية!</p>
        
        <p>مع أطيب التحيات،<br>فريق ULearn</p>
      </div>
    `;

    const text = `
      تأكيد التسجيل في فعالية ${event.title}
      
      عزيزي/عزيزتي ${registration.user.fullName},
      
      نؤكد لك تسجيلك في فعالية ${event.title}
      
      تفاصيل الفعالية:
      التاريخ: ${eventDate}
      الوقت: ${eventTime}
      المكان: ${event.location}
      رقم التأكيد: ${registration.confirmationCode}
      
      يرجى الاحتفاظ برقم التأكيد للمراجعة.
      
      نتطلع لرؤيتك في الفعالية!
      
      مع أطيب التحيات،
      فريق ULearn
    `;

    return { html, text };
  }

  getCancellationTemplate(registration, event) {
    const eventDate = new Date(event.date).toLocaleDateString('ar-SA');

    const html = `
      <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc3545;">إلغاء التسجيل في فعالية ${event.title}</h2>
        
        <p>عزيزي/عزيزتي ${registration.user.fullName},</p>
        
        <p>نؤكد لك إلغاء تسجيلك في فعالية <strong>${event.title}</strong> المقررة في ${eventDate}</p>
        
        <p>رقم التأكيد الملغي: ${registration.confirmationCode}</p>
        
        <p>إذا كان لديك أي استفسارات، يرجى التواصل معنا.</p>
        
        <p>مع أطيب التحيات،<br>فريق ULearn</p>
      </div>
    `;

    const text = `
      إلغاء التسجيل في فعالية ${event.title}
      
      عزيزي/عزيزتي ${registration.user.fullName},
      
      نؤكد لك إلغاء تسجيلك في فعالية ${event.title} المقررة في ${eventDate}
      
      رقم التأكيد الملغي: ${registration.confirmationCode}
      
      إذا كان لديك أي استفسارات، يرجى التواصل معنا.
      
      مع أطيب التحيات،
      فريق ULearn
    `;

    return { html, text };
  }

  getReminderTemplate(registration, event) {
    const eventDate = new Date(event.date).toLocaleDateString('ar-SA');
    const eventTime = `${event.startTime} - ${event.endTime}`;

    const html = `
      <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #299CF7;">تذكير بفعالية ${event.title}</h2>
        
        <p>عزيزي/عزيزتي ${registration.user.fullName},</p>
        
        <p>نذكرك بأن فعالية <strong>${event.title}</strong> ستبدأ قريباً!</p>
        
        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3>تفاصيل الفعالية:</h3>
          <p><strong>التاريخ:</strong> ${eventDate}</p>
          <p><strong>الوقت:</strong> ${eventTime}</p>
          <p><strong>المكان:</strong> ${event.location}</p>
        </div>
        
        <p>يرجى الحضور في الوقت المحدد.</p>
        
        <p>نتطلع لرؤيتك!</p>
        
        <p>مع أطيب التحيات،<br>فريق ULearn</p>
      </div>
    `;

    const text = `
      تذكير بفعالية ${event.title}
      
      عزيزي/عزيزتي ${registration.user.fullName},
      
      نذكرك بأن فعالية ${event.title} ستبدأ قريباً!
      
      تفاصيل الفعالية:
      التاريخ: ${eventDate}
      الوقت: ${eventTime}
      المكان: ${event.location}
      
      يرجى الحضور في الوقت المحدد.
      
      نتطلع لرؤيتك!
      
      مع أطيب التحيات،
      فريق ULearn
    `;

    return { html, text };
  }
}

module.exports = new EventEmailService();
