# PowerShell script for Windows UI Automation using UIAutomation
# This script finds windows and UI elements, and performs actions on them

param(
    [string]$Action,
    [string]$WindowTitle,
    [string]$ElementName,
    [string]$Value
)

# Load UIAutomation
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

function Get-WindowByTitle {
    param([string]$Title)

    $rootElement = [System.Windows.Automation.AutomationElement]::RootElement

    # Try exact match first
    $condition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::NameProperty,
        $Title
    )
    $window = $rootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
    if ($null -ne $window) { return $window }

    # Fallback: substring / case-insensitive match (handles localized titles like "Kalkulačka")
    $walker = New-Object System.Windows.Automation.TreeWalker([System.Windows.Automation.Condition]::TrueCondition)
    $child = $walker.GetFirstChild($rootElement)
    while ($null -ne $child) {
        $name = $child.Current.Name
        if ($name -and ($name.ToLowerInvariant() -like "*" + $Title.ToLowerInvariant() + "*")) {
            return $child
        }
        $child = $walker.GetNextSibling($child)
    }

    return $null
}

function Get-ElementByName {
    param($Parent, [string]$Name)
    
    if ($null -eq $Parent) { return $null }
    $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $Name)
    $element = $Parent.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
    
    return $element
}

function Get-ElementTree {
    param($Element, [int]$Depth = 0, [int]$MaxDepth = 3)
    
    if ($null -eq $Element -or $Depth -gt $MaxDepth) { return $null }
    
    $tree = @{
        id = $Element.Current.AutomationId
        type = $Element.Current.ControlType.ToString()
        name = $Element.Current.Name
        properties = @{
            isEnabled = $Element.Current.IsEnabled
            isOffscreen = $Element.Current.IsOffscreen
        }
        actions = @()
    }
    
    # Add position information
    try {
        $rect = $Element.Current.BoundingRectangle
        if ($rect.Width -gt 0 -and $rect.Height -gt 0) {
            $tree.position = @{
                x = [int]$rect.Left
                y = [int]$rect.Top
                width = [int]$rect.Width
                height = [int]$rect.Height
            }
        }
    } catch {
        # Bounding rectangle not available
    }
    
    # Determine available actions based on control type
    $patternIds = $Element.GetSupportedPatterns()
    if ($patternIds -contains [System.Windows.Automation.InvokePattern]::Pattern) {
        $tree.actions += "click"
    }
    if ($patternIds -contains [System.Windows.Automation.ValuePattern]::Pattern) {
        $tree.actions += "setValue"
        $tree.actions += "readValue"
    }
    if ($patternIds -contains [System.Windows.Automation.TextPattern]::Pattern) {
        $tree.actions += "setText"
    }
    
    # Get children
    if ($Depth -lt $MaxDepth) {
        $children = @()
        $walker = New-Object System.Windows.Automation.TreeWalker([System.Windows.Automation.Condition]::TrueCondition)
        $child = $walker.GetFirstChild($Element)
        
        while ($null -ne $child) {
            $childTree = Get-ElementTree $child ($Depth + 1) $MaxDepth
            if ($null -ne $childTree) {
                $children += $childTree
            }
            $child = $walker.GetNextSibling($child)
        }
        
        if ($children.Count -gt 0) {
            $tree.children = $children
        }
    }
    
    return $tree
}

function Click-Element {
    param($Element)
    
    if ($null -eq $Element) { 
        return @{success = $false; error = "Element not found" } 
    }
    
    try {
        $invokePattern = $Element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        if ($null -ne $invokePattern) {
            $invokePattern.Invoke()
            return @{success = $true; message = "Clicked element" }
        } else {
            # Try using keyboard
            [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
            return @{success = $true; message = "Activated element with keyboard" }
        }
    } catch {
        return @{success = $false; error = $_.Exception.Message }
    }
}

function Set-ElementValue {
    param($Element, [string]$Value)
    
    if ($null -eq $Element) { 
        return @{success = $false; error = "Element not found" }
    }
    
    try {
        $valuePattern = $Element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        if ($null -ne $valuePattern) {
            $valuePattern.SetValue($Value)
            return @{success = $true; message = "Set value" }
        } else {
            return @{success = $false; error = "Element does not support value pattern" }
        }
    } catch {
        return @{success = $false; error = $_.Exception.Message }
    }
}

function Read-ElementValue {
    param($Element)
    
    if ($null -eq $Element) { 
        return @{success = $false; error = "Element not found" }
    }
    
    try {
        $valuePattern = $Element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        if ($null -ne $valuePattern) {
            return @{success = $true; value = $valuePattern.Current.Value }
        } else {
            return @{success = $false; error = "Element does not support value pattern" }
        }
    } catch {
        return @{success = $false; error = $_.Exception.Message }
    }
}

# Main execution
try {
    switch ($Action) {
        "getWindowTree" {
            $window = Get-WindowByTitle $WindowTitle
            if ($null -eq $window) {
                Write-Output (ConvertTo-Json @{success = $false; error = "Window not found: $WindowTitle" })
            } else {
                $tree = Get-ElementTree $window
                Write-Output (ConvertTo-Json @{success = $true; data = $tree } -Depth 10)
            }
        }
        "click" {
            $window = Get-WindowByTitle $WindowTitle
            $element = Get-ElementByName $window $ElementName
            $result = Click-Element $element
            Write-Output (ConvertTo-Json $result)
        }
        "setValue" {
            $window = Get-WindowByTitle $WindowTitle
            $element = Get-ElementByName $window $ElementName
            $result = Set-ElementValue $element $Value
            Write-Output (ConvertTo-Json $result)
        }
        "readValue" {
            $window = Get-WindowByTitle $WindowTitle
            $element = Get-ElementByName $window $ElementName
            $result = Read-ElementValue $element
            Write-Output (ConvertTo-Json $result)
        }
        default {
            Write-Output (ConvertTo-Json @{success = $false; error = "Unknown action: $Action" })
        }
    }
} catch {
    Write-Output (ConvertTo-Json @{success = $false; error = $_.Exception.Message })
}
