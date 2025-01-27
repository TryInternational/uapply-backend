const mongoose = require('mongoose');
const { toJSON, paginate } = require('./plugins');

const NewsSchema = mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    thumbnail: {
      type: String,
      required: true,
    },
    subtitle: {
      type: String,
    },
    body: {
      type: String,
      required: true,
    },
    qrCodeUrl: {
      type: String, // The URL that the QR code points to
    },
    qrCodeImage: {
      type: String, // Base64 data or file path of the generated QR code
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Add plugin that converts mongoose to JSON
NewsSchema.plugin(toJSON);
NewsSchema.plugin(paginate);

/**
 * Generate and store QR code data
 * @param {String} url - The URL to encode in the QR code
 */
NewsSchema.methods.generateQrCode = async function (url) {
  const QRCode = require('qrcode');

  try {
    // Generate the QR code as base64
    const qrCodeImage = await QRCode.toDataURL(url);

    // Update the model instance
    this.qrCodeUrl = url;
    this.qrCodeImage = qrCodeImage;

    // Save the updated document
    await this.save();
    return qrCodeImage;
  } catch (error) {
    throw new Error('Failed to generate QR code');
  }
};

/**
 * @typedef News
 */
const News = mongoose.model('News', NewsSchema);

module.exports = News;
