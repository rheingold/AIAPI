$env:SKIP_SESSION_AUTH = "true"
$exe = ".\dist\helpers\MSOfficeWin.exe"

function Word($action) {
    $r = & $exe "word" $action 2>$null
    $short = if ($action.Length -gt 70) { $action.Substring(0,70) + "..." } else { $action }
    Write-Host ("  >> " + $short) -ForegroundColor Cyan
    Write-Host ("     " + $r) -ForegroundColor Green
    Start-Sleep -Milliseconds 250
    return $r
}

function WordFile($action) {
    $tmp = [System.IO.Path]::GetTempFileName()
    [System.IO.File]::WriteAllLines($tmp, [string[]]@("word", $action), [System.Text.Encoding]::UTF8)
    $r = & $exe "--inject-mode=direct" $tmp 2>$null
    Remove-Item $tmp -ErrorAction SilentlyContinue
    $short = if ($action.Length -gt 70) { $action.Substring(0,70) + "..." } else { $action }
    Write-Host ("  >> " + $short) -ForegroundColor Cyan
    Write-Host ("     " + $r) -ForegroundColor Green
    Start-Sleep -Milliseconds 250
    return $r
}

Write-Host "`n=== Neural Network Document Showcase ===" -ForegroundColor Yellow

# ── Step 1: New document ──────────────────────────────────────────────────────
Write-Host "`n[1/6] Creating new Word document..." -ForegroundColor Magenta
Word "{NEWDOC}"
Start-Sleep -Milliseconds 1500

# ── Step 2: Focus ─────────────────────────────────────────────────────────────
Write-Host "`n[2/6] Bringing Word to foreground..." -ForegroundColor Magenta
Word "{FOCUS}"
Start-Sleep -Milliseconds 700

# ── Step 3: Write body (54 paragraphs, literal \n as separator) ───────────────
Write-Host "`n[3/6] Writing document body (54 paragraphs)..." -ForegroundColor Magenta

# Paragraph structure (split on literal \n by WriteWord):
#  1: title          2: blank           3: intro           4: blank
#  5: "1. Activation Functions"         6: section intro   7: blank
#  8: "ReLU..."      9: ReLU text      10: blank
# 11: "Sigmoid"     12: Sigmoid text   13: blank
# 14: "Tanh..."     15: Tanh text      16: blank
# 17: "Softmax"     18: Softmax text   19: blank
# 20: "2. Loss Functions"              21: section intro  22: blank
# 23: "MSE"         24: MSE text       25: blank
# 26: "BCE"         27: BCE text       28: blank
# 29: "CCE"         30: CCE text       31: blank
# 32: "3. Optimisation Algorithms"     33: section intro  34: blank
# 35: "SGD"         36: SGD text       37: blank
# 38: "Adam"        39: Adam text      40: blank
# 41: "RMSProp"     42: RMSProp text   43: blank
# 44: "4. Regularisation Techniques"   45: section intro  46: blank
# 47: "Dropout"     48: Dropout text   49: blank
# 50: "L2 Reg..."   51: L2 text        52: blank
# 53: "Batch Norm"  54: BN text

$body  = "Neural Network Architecture and Key Functions"
$body += "\n"
$body += "\nAn overview of fundamental functions and architectural components used in modern deep learning. These mathematical building blocks enable artificial neural networks to learn complex representations from data."
$body += "\n"
$body += "\n1. Activation Functions"
$body += "\nActivation functions introduce non-linearity into neural networks, enabling arbitrarily complex function approximation. Without them, a deep network would collapse to a single linear transformation regardless of its depth."
$body += "\n"
$body += "\nReLU (Rectified Linear Unit)"
$body += "\nf(x) = max(0, x). The most widely used activation in deep learning. Computationally efficient, sparse-activating, and free from vanishing gradients for positive inputs. Default choice for hidden layers in convolutional and fully-connected networks."
$body += "\n"
$body += "\nSigmoid"
$body += "\nf(x) = 1 / (1 + e^-x). Squashes any real input to (0, 1). Standard output activation for binary classification. Prone to vanishing gradients in deep networks due to saturation at extreme values."
$body += "\n"
$body += "\nTanh (Hyperbolic Tangent)"
$body += "\nf(x) = (e^x - e^-x) / (e^x + e^-x). Zero-centred output in (-1, 1). Preferred over sigmoid for hidden layers because zero-centred outputs yield stronger gradient signals during backpropagation."
$body += "\n"
$body += "\nSoftmax"
$body += "\nConverts a vector of real-valued logits into a probability distribution over K classes via normalised exponentiation: p_k = exp(z_k) / sum(exp(z_j)). Standard output for multi-class classification."
$body += "\n"
$body += "\n2. Loss Functions"
$body += "\nLoss functions quantify the discrepancy between model predictions and ground-truth labels, providing the scalar objective that gradient-based optimisation drives towards a minimum."
$body += "\n"
$body += "\nMean Squared Error (MSE)"
$body += "\nL = (1/n) * sum((y - y_hat)^2). Penalises large errors quadratically. Standard loss for regression. Sensitive to outliers due to the squared penalty term."
$body += "\n"
$body += "\nBinary Cross-Entropy"
$body += "\nL = -[y * log(p) + (1-y) * log(1-p)]. Measures divergence between predicted probability and binary label. Used with sigmoid output for binary classification tasks."
$body += "\n"
$body += "\nCategorical Cross-Entropy"
$body += "\nL = -sum(y_k * log(p_k)). Generalises binary cross-entropy to K mutually exclusive classes. Standard loss for multi-class problems, used with a softmax output layer."
$body += "\n"
$body += "\n3. Optimisation Algorithms"
$body += "\nOptimisation algorithms iteratively update network parameters using gradient information to navigate the high-dimensional loss landscape towards a minimum of the objective function."
$body += "\n"
$body += "\nStochastic Gradient Descent (SGD)"
$body += "\ntheta = theta - lr * gradient(L). Parameters updated via gradients computed on random mini-batches. Simple and well-understood; requires careful learning rate scheduling. Momentum extension significantly accelerates convergence."
$body += "\n"
$body += "\nAdam (Adaptive Moment Estimation)"
$body += "\nCombines first-moment momentum with second-moment RMSProp-style gradient scaling to maintain per-parameter adaptive learning rates. Robust to noisy gradients. The default optimiser for most modern deep learning tasks."
$body += "\n"
$body += "\nRMSProp"
$body += "\nDivides the learning rate by an exponentially decaying moving average of squared gradients, preventing excessive rate decay. Particularly effective for recurrent neural networks and non-stationary objectives."
$body += "\n"
$body += "\n4. Regularisation Techniques"
$body += "\nRegularisation methods constrain effective model capacity, inject noise, or penalise weight magnitude during training to reduce overfitting and improve generalisation to unseen data."
$body += "\n"
$body += "\nDropout"
$body += "\nRandomly zeroes a fraction p of activations during each training forward pass. Forces redundant representations and can be interpreted as ensembling 2^n sub-networks. Applied with p = 0.5 for fully-connected layers and p = 0.1-0.2 for convolutional layers."
$body += "\n"
$body += "\nL2 Regularisation (Weight Decay)"
$body += "\nAdds (lambda/2)||w||^2 to the loss, penalising large weight magnitudes and encouraging small, diffuse weight distributions. Equivalent to a Gaussian prior on weights in the Bayesian interpretation."
$body += "\n"
$body += "\nBatch Normalisation"
$body += "\nNormalises layer inputs to zero mean and unit variance over each mini-batch, then applies learnable scale and shift parameters gamma and beta. Reduces internal covariate shift, stabilises and accelerates training, and provides a mild regularisation effect."

WordFile ("{WRITE:body|" + $body + "}")
Start-Sleep -Milliseconds 600

# ── Step 4: Apply paragraph styles ───────────────────────────────────────────
Write-Host "`n[4/6] Applying heading styles..." -ForegroundColor Magenta

# Heading 1 - document title
Word "{FORMAT:para:1|Heading 1}"

# Heading 2 - four main sections
foreach ($n in @(5, 20, 32, 44)) {
    Word ("{FORMAT:para:" + $n + "|Heading 2}")
}

# Heading 3 - subsections
foreach ($n in @(8, 11, 14, 17, 23, 26, 29, 35, 38, 41, 47, 50, 53)) {
    Word ("{FORMAT:para:" + $n + "|Heading 3}")
}

# ── Step 5: Save ──────────────────────────────────────────────────────────────
Write-Host "`n[5/6] Saving document..." -ForegroundColor Magenta
Word "{SAVE}"
Start-Sleep -Milliseconds 400

# ── Step 6: Read back a few paragraphs to verify ─────────────────────────────
Write-Host "`n[6/6] Reading back title and first section heading..." -ForegroundColor Magenta
Word "{READ:para:1}"
Word "{READ:para:5}"
Word "{READ:para:32}"

Write-Host "`n=== Showcase complete! ===" -ForegroundColor Yellow
Write-Host "Word document open with 4 sections, formatted headings." -ForegroundColor White
