import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.File;
import javax.imageio.ImageIO;

/**
 * Cuts the square source art into the five legacy launcher densities. There is no ImageMagick on the
 * build machine and the Gradle-free build has no plugin to do it, so this runs with
 * `java tools/MakeIcons.java icon-source.png res` on any JDK.
 */
public class MakeIcons {
  private static final int[] SIZES = {48, 72, 96, 144, 192};
  private static final String[] BUCKETS = {"mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"};

  public static void main(String[] args) throws Exception {
    if (args.length != 2) {
      throw new IllegalArgumentException("usage: MakeIcons <source.png> <res-dir>");
    }
    BufferedImage source = ImageIO.read(new File(args[0]));
    if (source.getWidth() != source.getHeight()) {
      throw new IllegalArgumentException("source must be square, got "
          + source.getWidth() + "x" + source.getHeight());
    }
    File res = new File(args[1]);
    for (int i = 0; i < SIZES.length; i++) {
      File dir = new File(res, "mipmap-" + BUCKETS[i]);
      dir.mkdirs();
      File out = new File(dir, "ic_launcher.png");
      ImageIO.write(scale(source, SIZES[i]), "png", out);
      System.out.println(out + " " + SIZES[i] + "px");
    }
  }

  /** Halving in steps keeps a 1024px artwork readable at 48px, which a single-pass scale does not. */
  private static BufferedImage scale(BufferedImage from, int to) {
    BufferedImage current = from;
    while (current.getWidth() / 2 >= to) {
      current = resize(current, Math.max(to, current.getWidth() / 2));
    }
    return current.getWidth() == to ? current : resize(current, to);
  }

  private static BufferedImage resize(BufferedImage from, int size) {
    BufferedImage to = new BufferedImage(size, size, BufferedImage.TYPE_INT_ARGB);
    Graphics2D g = to.createGraphics();
    g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
    g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
    g.drawImage(from, 0, 0, size, size, null);
    g.dispose();
    return to;
  }
}
